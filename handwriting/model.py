"""
handwriting/model.py
Kompaktes CRNN-Netzwerk (1D-CNN + BiLSTM + CTC) für Strich-Inferenz.
4 Eingangsmerkmale: [dx, dy, pen_down, y_rel].
Modellgröße: ~6 MB (ca. 1.800.000 Parameter).
"""

from typing import Optional
import torch
import torch.nn as nn
from vocabulary import VOCAB_SIZE


class HandwritingCRNN(nn.Module):
    def __init__(
        self,
        in_features: int = 4,
        hidden_size: int = 192,
        num_layers: int = 3,
        vocab_size: int = VOCAB_SIZE,
        dropout: float = 0.0,
    ):
        super().__init__()
        self.in_features = in_features
        self.vocab_size = vocab_size
        self.hidden_size = hidden_size
        self.num_layers = num_layers

        # 1D-CNN zur Merkmalsextraktion über lokale Strichmuster
        self.cnn = nn.Sequential(
            nn.Conv1d(in_features, 64, kernel_size=5, padding=2),
            nn.BatchNorm1d(64),
            nn.ReLU(inplace=True),

            nn.Conv1d(64, 128, kernel_size=5, padding=2),
            nn.BatchNorm1d(128),
            nn.ReLU(inplace=True),
            nn.MaxPool1d(kernel_size=2, stride=2),  # Zeitachse um Faktor 2 komprimieren

            nn.Conv1d(128, 192, kernel_size=3, padding=1),
            nn.BatchNorm1d(192),
            nn.ReLU(inplace=True),
        )

        # 3-lagiges Bidirektionales LSTM für Sequenzmodellierung
        self.lstm = nn.LSTM(
            input_size=192,
            hidden_size=hidden_size,
            num_layers=num_layers,
            bidirectional=True,
            batch_first=False,
            dropout=dropout if num_layers > 1 else 0.0,
        )

        # Ausgabekopf auf das CTC-Vokabular
        self.fc = nn.Linear(hidden_size * 2, vocab_size)
        self.log_softmax = nn.LogSoftmax(dim=-1)

    def forward(self, x: torch.Tensor, in_lens: Optional[torch.Tensor] = None) -> torch.Tensor:
        """
        Input x: Shape (batch_size, seq_len, 4)
        Output:  Shape (compressed_seq_len, batch_size, vocab_size)
        """
        # x von (B, T, C) nach (B, C, T) für Conv1d
        x = x.transpose(1, 2)
        feats = self.cnn(x)

        # Von (B, C, T_out) nach (T_out, B, C) für LSTM
        feats = feats.permute(2, 0, 1)

        # Gepackte Sequenzen auch auf der GPU: Sonst liest das Rückwärts-LSTM erst das Padding,
        # was es in der App (ohne Padding) nie gibt. Beim ONNX-Export ohne Packing.
        if (
            in_lens is not None
            and not torch.jit.is_tracing()
            and not torch.onnx.is_in_onnx_export()
        ):
            out_lens = torch.clamp(in_lens // 2, min=1).cpu()
            packed = nn.utils.rnn.pack_padded_sequence(
                feats, out_lens, batch_first=False, enforce_sorted=False
            )
            lstm_out, _ = self.lstm(packed)
            lstm_out, _ = nn.utils.rnn.pad_packed_sequence(lstm_out, batch_first=False)
        else:
            lstm_out, _ = self.lstm(feats)

        logits = self.fc(lstm_out)
        return self.log_softmax(logits)


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


if __name__ == "__main__":
    net = HandwritingCRNN()
    num_params = count_parameters(net)
    print(f"Modell initialisiert. Parameteranzahl: {num_params:,}")

    # Test-Forward Pass mit Dummy-Input
    dummy_input = torch.randn(2, 100, 4)  # Batch 2, 100 Schritte, 4 Features
    dummy_lens = torch.tensor([100, 80], dtype=torch.long)
    out = net(dummy_input, in_lens=dummy_lens)
    print(f"Output Shape: {out.shape} (T_out, Batch, Vocab)")
