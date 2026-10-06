"""
handwriting/model.py
Kompaktes CRNN-Netzwerk (1D-CNN + BiLSTM + CTC) für Strich-Inferenz.
Modellgröße: ~4 MB (ca. 900.000 Parameter).
"""

import torch
import torch.nn as nn
from vocabulary import VOCAB_SIZE


class HandwritingCRNN(nn.Module):
    def __init__(self, in_features: int = 3, hidden_size: int = 128, vocab_size: int = VOCAB_SIZE):
        super().__init__()
        self.vocab_size = vocab_size

        # 1D-CNN zur Merkmalsextraktion über lokale Strichmuster
        self.cnn = nn.Sequential(
            nn.Conv1d(in_features, 64, kernel_size=5, padding=2),
            nn.BatchNorm1d(64),
            nn.ReLU(inplace=True),

            nn.Conv1d(64, 128, kernel_size=5, padding=2),
            nn.BatchNorm1d(128),
            nn.ReLU(inplace=True),
            nn.MaxPool1d(kernel_size=2, stride=2),  # Zeitachse um Faktor 2 komprimieren

            nn.Conv1d(128, 128, kernel_size=3, padding=1),
            nn.BatchNorm1d(128),
            nn.ReLU(inplace=True),
        )

        # 2-lagiges Bidirektionales LSTM für zeitliche Sequenzmodellierung
        self.lstm = nn.LSTM(
            input_size=128,
            hidden_size=hidden_size,
            num_layers=2,
            bidirectional=True,
            batch_first=False,
            dropout=0.2,
        )

        # Ausgabekopf auf das CTC-Vokabular
        self.fc = nn.Linear(hidden_size * 2, vocab_size)
        self.log_softmax = nn.LogSoftmax(dim=-1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Input x: Shape (batch_size, seq_len, 3)
        Output:  Shape (compressed_seq_len, batch_size, vocab_size)
        """
        # x von (B, T, C) nach (B, C, T) für Conv1d
        x = x.transpose(1, 2)
        feats = self.cnn(x)

        # Von (B, C, T_out) nach (T_out, B, C) für LSTM
        feats = feats.permute(2, 0, 1)

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
    dummy_input = torch.randn(2, 100, 3)  # Batch 2, 100 Schritte, 3 Features
    out = net(dummy_input)
    print(f"Output Shape: {out.shape} (T_out, Batch, Vocab)")
