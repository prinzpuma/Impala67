# Winziges Test-Modell für den ONNX-Pfad (kein echtes Embedding-Modell):
# last_hidden_state = Tabelle[input_ids] * attention_mask, Breite 4, Wortschatz 8.
# Neu erzeugen (Python mit `pip install onnx numpy`): python make.py
import json, numpy as np, onnx
from onnx import TensorProto, helper, numpy_helper

vocab = ["[PAD]", "[UNK]", "licht", "wasser", "pflanze", "auto", "motor", "strasse"]
table = np.array([[0, 0, 0, 0], [0.1, 0.1, 0.1, 0.1], [1, 0, 0, 5], [0.8, 0.2, 0, -5],
                  [0.7, 0.3, 0.1, 9], [0, 1, 0, 1], [0, 0.9, 0.2, -1], [0.1, 0.8, 0.1, 3]], dtype=np.float32)
nodes = [
    helper.make_node("Gather", ["table", "input_ids"], ["emb"], axis=0),
    helper.make_node("Cast", ["attention_mask"], ["maskf"], to=TensorProto.FLOAT),
    helper.make_node("Unsqueeze", ["maskf", "axes"], ["mask3"]),
    helper.make_node("Mul", ["emb", "mask3"], ["last_hidden_state"]),
]
graph = helper.make_graph(nodes, "tiny",
    [helper.make_tensor_value_info("input_ids", TensorProto.INT64, ["B", "S"]),
     helper.make_tensor_value_info("attention_mask", TensorProto.INT64, ["B", "S"])],
    [helper.make_tensor_value_info("last_hidden_state", TensorProto.FLOAT, ["B", "S", 4])],
    [numpy_helper.from_array(table, "table"), numpy_helper.from_array(np.array([-1], dtype=np.int64), "axes")])
model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
model.ir_version = 8
onnx.checker.check_model(model)
onnx.save(model, "onnx/model.onnx")
tok = {
    "version": "1.0", "truncation": None, "padding": None, "added_tokens": [],
    "normalizer": {"type": "Lowercase"}, "pre_tokenizer": {"type": "Whitespace"},
    "post_processor": None, "decoder": None,
    "model": {"type": "WordLevel", "vocab": {w: i for i, w in enumerate(vocab)}, "unk_token": "[UNK]"},
}
with open("tokenizer.json", "w") as f:
    json.dump(tok, f, indent=1)
