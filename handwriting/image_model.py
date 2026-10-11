"""Bild-Modell für Zeilen: ResNet18-Stamm (bis layer3) + 3× BiLSTM-256 + CTC.

Nachbau von de-htr-web-v2 (naeyn, Apache-2.0, https://huggingface.co/naeyn/de-htr-web-v2), damit dessen
Gewichte als Startpunkt dienen. BatchNorm ist dort schon in die Faltungen eingerechnet, daher Faltungen mit Bias
und ohne BatchNorm. Ausgabe nutzt unser Vokabular (vocabulary.py): gemeinsame Zeichen übernehmen de-htrs
Gewichte, fehlende (z. B. ^ √ π) starten neu.

Eingabe: [B, 1, 64, W] Graustufen in [0, 1] (1 = weiß), W Vielfaches von 4. Ausgabe: Logits [W/4, B, VOCAB_SIZE].
"""

import json
import os
from typing import List

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from vocabulary import CHARS, VOCAB_SIZE

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


class Block(nn.Module):
    def __init__(self, cin: int, cout: int, stride=(1, 1)):
        super().__init__()
        self.conv1 = nn.Conv2d(cin, cout, 3, stride, 1)
        self.conv2 = nn.Conv2d(cout, cout, 3, 1, 1)
        self.down = nn.Conv2d(cin, cout, 1, stride, 0) if stride != (1, 1) or cin != cout else None

    def forward(self, x):
        out = self.conv2(F.relu(self.conv1(x)))
        return F.relu(out + (self.down(x) if self.down is not None else x))


class ImageCRNN(nn.Module):
    def __init__(self, num_classes: int = VOCAB_SIZE, hidden: int = 256, layers: int = 3):
        super().__init__()
        self.register_buffer("mean", torch.tensor(IMAGENET_MEAN).view(1, 3, 1, 1), persistent=False)
        self.register_buffer("std", torch.tensor(IMAGENET_STD).view(1, 3, 1, 1), persistent=False)
        self.conv1 = nn.Conv2d(3, 64, 7, 2, 3)
        self.pool = nn.MaxPool2d(3, (2, 1), 1)
        self.layer1 = nn.Sequential(Block(64, 64), Block(64, 64))
        self.layer2 = nn.Sequential(Block(64, 128, (2, 2)), Block(128, 128))
        self.layer3 = nn.Sequential(Block(128, 256, (2, 1)), Block(256, 256))
        self.proj = nn.Conv2d(256, 1536, 1)
        self.rnn = nn.LSTM(1536, hidden, num_layers=layers, bidirectional=True)
        self.classifier = nn.Linear(2 * hidden, num_classes)

    def convs(self) -> List[nn.Conv2d]:
        """Faltungen in derselben Reihenfolge wie im de-htr-ONNX-Graphen."""
        out = [self.conv1]
        for layer in (self.layer1, self.layer2, self.layer3):
            for b in layer:
                out += [b.conv1, b.conv2] + ([b.down] if b.down is not None else [])
        return out + [self.proj]

    def forward(self, x):
        x = (x.expand(-1, 3, -1, -1) - self.mean) / self.std
        x = self.pool(F.relu(self.conv1(x)))
        x = self.layer3(self.layer2(self.layer1(x)))
        x = F.relu(self.proj(x)).mean(dim=2)  # [B, 1536, T]
        x, _ = self.rnn(x.permute(2, 0, 1))  # [T, B, 2H]
        return self.classifier(x)  # [T, B, C]


def _lstm_gates_onnx_to_torch(w: np.ndarray, hidden: int) -> np.ndarray:
    """ONNX-Gate-Reihenfolge i, o, f, c → PyTorch i, f, g(c), o."""
    i, o, f, c = (w[k * hidden:(k + 1) * hidden] for k in range(4))
    return np.concatenate([i, f, c, o])


def load_dehtr_onnx(model: ImageCRNN, onnx_path: str, config_path: str) -> ImageCRNN:
    """Übernimmt die Gewichte aus de-htr model-fp32.onnx und bildet die Ausgabe auf unser Vokabular ab."""
    import onnx
    from onnx import numpy_helper

    graph = onnx.load(onnx_path).graph
    init = {i.name: numpy_helper.to_array(i) for i in graph.initializer}
    conv_nodes = [n for n in graph.node if n.op_type == "Conv"]
    lstm_nodes = [n for n in graph.node if n.op_type == "LSTM"]
    convs = model.convs()
    assert len(conv_nodes) == len(convs) and len(lstm_nodes) == model.rnn.num_layers, "Unerwarteter de-htr-Graph"

    with torch.no_grad():
        for node, conv in zip(conv_nodes, convs):
            conv.weight.copy_(torch.from_numpy(init[node.input[1]]))
            conv.bias.copy_(torch.from_numpy(init[node.input[2]]))
        H = model.rnn.hidden_size
        for k, node in enumerate(lstm_nodes):
            W, R, B = init[node.input[1]], init[node.input[2]], init[node.input[3]]
            for d, suffix in enumerate(("", "_reverse")):
                getattr(model.rnn, f"weight_ih_l{k}{suffix}").copy_(torch.from_numpy(_lstm_gates_onnx_to_torch(W[d], H)))
                getattr(model.rnn, f"weight_hh_l{k}{suffix}").copy_(torch.from_numpy(_lstm_gates_onnx_to_torch(R[d], H)))
                getattr(model.rnn, f"bias_ih_l{k}{suffix}").copy_(torch.from_numpy(_lstm_gates_onnx_to_torch(B[d, :4 * H], H)))
                getattr(model.rnn, f"bias_hh_l{k}{suffix}").copy_(torch.from_numpy(_lstm_gates_onnx_to_torch(B[d, 4 * H:], H)))

        matmul = next(n for n in graph.node if n.op_type == "MatMul")
        w_src = init[matmul.input[1]].T  # [112, 512]
        b_src = init["classifier.bias"]
        alphabet = json.load(open(config_path, encoding="utf-8"))["alphabet"]
        src_index = {c: i + 1 for i, c in enumerate(alphabet)}
        src_index[CHARS[0]] = 0  # Blank
        mapped = 0
        for idx, ch in enumerate(CHARS):
            j = src_index.get(ch)
            if j is not None:
                model.classifier.weight[idx].copy_(torch.from_numpy(w_src[j]))
                model.classifier.bias[idx] = float(b_src[j])
                mapped += 1
            else:
                # Neue Zeichen starten klein und unwahrscheinlich, bis das Training sie lernt
                model.classifier.weight[idx].normal_(0, 0.01)
                model.classifier.bias[idx] = float(b_src.min())
    missing = [c for c in CHARS[1:] if c not in src_index]
    print(f"de-htr-Gewichte übernommen: {mapped}/{len(CHARS)} Ausgabezeichen, neu: {''.join(missing)}")
    return model


def export_image_onnx(model: ImageCRNN, path: str = "model.onnx", int8: bool = True) -> str:
    """Export mit dynamischer Breite. int8: nur Gewichte quantisiert (QDQ), läuft in ONNX Runtime Web (WASM)."""
    import warnings

    model = model.cpu().eval()
    fp32_path = path if not int8 else path.replace(".onnx", "-fp32.onnx")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        torch.onnx.export(
            model, torch.ones(1, 1, 64, 256), fp32_path, opset_version=17, do_constant_folding=True,
            input_names=["input"], output_names=["output"],
            dynamic_axes={"input": {0: "batch", 3: "width"}, "output": {0: "steps", 1: "batch"}}, dynamo=False,
        )
    if int8:
        quantize_weights_qdq(fp32_path, path)
    print(f"Bild-Modell exportiert: {path} ({os.path.getsize(path) / 1024 / 1024:.1f} MB)")
    return path


def quantize_weights_qdq(src: str, dst: str, min_size: int = 4096):
    """Große Gewichte (Conv, LSTM, MatMul) als int8 pro Kanal speichern, vor der Nutzung per DequantizeLinear
    zurück nach float. Gerechnet wird weiter in float, daher keine Integer-Operatoren wie ConvInteger,
    die ONNX Runtime Web nicht kennt."""
    import onnx
    from onnx import helper, numpy_helper

    m = onnx.load(src)
    g = m.graph
    consumers = {}
    for n in g.node:
        for k, name in enumerate(n.input):
            consumers.setdefault(name, []).append((n, k))
    new_inits, new_nodes = [], []
    for t in list(g.initializer):
        a = numpy_helper.to_array(t)
        if a.dtype != np.float32 or a.size < min_size or a.ndim < 2:
            new_inits.append(t)
            continue
        axis = 1 if (a.ndim == 2 and any(n.op_type == "MatMul" for n, _ in consumers.get(t.name, []))) else 0
        if a.ndim == 3:  # LSTM [dir, 4H, in]: pro Zeile über Achse 1 skalieren
            axis = 1
        red = tuple(i for i in range(a.ndim) if i != axis)
        scale = np.maximum(np.abs(a).max(axis=red), 1e-8) / 127.0
        shape = [1] * a.ndim
        shape[axis] = -1
        q = np.clip(np.round(a / scale.reshape(shape)), -127, 127).astype(np.int8)
        new_inits += [numpy_helper.from_array(q, t.name + "_q"),
                      numpy_helper.from_array(scale.astype(np.float32), t.name + "_s"),
                      numpy_helper.from_array(np.zeros_like(scale, dtype=np.int8), t.name + "_z")]
        new_nodes.append(helper.make_node("DequantizeLinear", [t.name + "_q", t.name + "_s", t.name + "_z"],
                                          [t.name], axis=axis))
    del g.initializer[:]
    g.initializer.extend(new_inits)
    nodes = new_nodes + list(g.node)
    del g.node[:]
    g.node.extend(nodes)
    onnx.checker.check_model(m)
    onnx.save(m, dst)
