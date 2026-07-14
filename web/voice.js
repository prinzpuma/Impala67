"use strict";

// voice.js — absichtlich ohne Abhängigkeiten: Die Web Speech API liefert die
// kostenlose Eingabe/Ausgabe, die bestehende Chat-Pipeline bleibt unverändert.
let recognition = null;
let listening = false;
// Sprachausgabe ist zunächst bewusst deaktiviert; der Voice-Modus transkribiert
// nur und nutzt anschließend den vorhandenen Chat. Für späterer Aktivierung
// reicht es, diesen Standardwert bzw. eine Settings-Option auf true zu setzen.
let outputEnabled = false;
let speakNextReply = false;

function toast(message, kind) {
	if (window.U && typeof window.U.toast === "function") window.U.toast(message, kind || "success");
}

function updateButton() {
	document.querySelectorAll("#btnVoice, #btnVoiceFull").forEach((btn) => {
		btn.classList.toggle("active", listening);
		btn.textContent = listening ? "■" : "🎙";
		btn.title = listening ? "Aufnahme stoppen" : "Spracheingabe starten (Alt+Leertaste)";
	});
}

function clearRecognition() {
	listening = false;
	updateButton();
}

function speechRecognitionCtor() {
	return window.SpeechRecognition || window.webkitSpeechRecognition;
}

function start(type) {
	if (listening) return stopListening();
	const Recognition = speechRecognitionCtor();
	if (!Recognition) {
		toast("Spracheingabe wird von diesem Browser nicht unterstützt.", "error");
		return false;
	}
	if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
		toast("Mikrofonzugriff ist nicht verfügbar.", "error");
		return false;
	}

	recognition = new Recognition();
	recognition.lang = "de-DE";
	recognition.continuous = false;
	recognition.interimResults = false;
	recognition.maxAlternatives = 1;
	recognition.onstart = () => {
		listening = true;
		updateButton();
	};
	recognition.onresult = (event) => {
		const text = String(event.results[0][0].transcript || "").trim();
		if (!text) return;
		if (window.S && window.S.aiBusy) {
			toast("Die KI antwortet noch — bitte kurz warten.", "error");
			return;
		}
		speakNextReply = true;
		const chatType = type || "side";
		window.CHAT_FULLSCREEN.sendChatMessage(text, chatType).catch((err) => {
			speakNextReply = false;
			toast("Sprachnachricht konnte nicht gesendet werden: " + err.message, "error");
		});
	};
	recognition.onerror = (event) => {
		if (event.error !== "aborted") toast("Spracheingabe: " + event.error, "error");
	};
	recognition.onend = clearRecognition;
	try {
		recognition.start();
		return true;
	} catch (err) {
		clearRecognition();
		toast("Mikrofon konnte nicht gestartet werden: " + err.message, "error");
		return false;
	}
}

function stopListening() {
	if (recognition) {
		try { recognition.stop(); } catch { /* bereits beendet */ }
	}
	clearRecognition();
}

function plainText(text) {
	return String(text || "")
		.replace(/```[\s\S]*?```/g, "")
		.replace(/!?(\[[^\]]*\])\([^)]*\)/g, "$1")
		.replace(/[#$*_~`>|]/g, " ")
		.replace(/\$+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function speak(text) {
	if (!window.speechSynthesis) return false;
	const content = plainText(text);
	if (!content) return false;
	window.speechSynthesis.cancel();
	const utterance = new SpeechSynthesisUtterance(content);
	utterance.lang = "de-DE";
	const germanVoice = window.speechSynthesis.getVoices().find((voice) => /^de([_-]|$)/i.test(voice.lang));
	if (germanVoice) utterance.voice = germanVoice;
	window.speechSynthesis.speak(utterance);
	return true;
}

function consumeReply() {
	const shouldSpeak = outputEnabled && speakNextReply;
	speakNextReply = false;
	return shouldSpeak;
}

function stop() {
	stopListening();
	speakNextReply = false;
	if (window.speechSynthesis) window.speechSynthesis.cancel();
}

function isActive() {
	return listening || !!(window.speechSynthesis && window.speechSynthesis.speaking);
}

export const VOICE = { start, toggle: start, stopListening, stop, speak, consumeReply, isActive };