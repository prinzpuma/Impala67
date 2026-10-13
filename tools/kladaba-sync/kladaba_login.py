import sys
import time
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

AUTH_FILE = Path(__file__).parent / "kladaba_cookies.json"

def main():
    print("Starte Chromium-Browser für Kladaba-Login (Janus TF Freiburg)...", flush=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()

        print("Öffne Janus-Login...", flush=True)
        page.goto("https://db.fachschaft.tf/accounts/janus/login/?next=/submission/", wait_until="domcontentloaded")

        print("Browserfenster ist geöffnet. Bitte im Fenster einloggen...", flush=True)
        start_time = time.time()
        logged_in = False

        while time.time() - start_time < 300:  # 5 Minuten Zeit
            time.sleep(1)
            url = page.url
            # Login abgeschlossen wenn zurück auf db.fachschaft.tf und nicht mehr auf /accounts/
            if "db.fachschaft.tf" in url and "accounts" not in url:
                try:
                    resp = page.request.get("https://db.fachschaft.tf/download/3076", max_redirects=0)
                    if resp.status in [200, 206] or (resp.status == 302 and "janus/login" not in resp.headers.get("location", "")):
                        logged_in = True
                        break
                except Exception:
                    pass

        if logged_in:
            print("Login erfolgreich bestätigt!", flush=True)
            cookies = context.cookies()
            with open(AUTH_FILE, "w", encoding="utf-8") as f:
                json.dump(cookies, f, indent=2)
            print(f"Cookies gespeichert in {AUTH_FILE}", flush=True)
        else:
            print("Timeout oder Login nicht abgeschlossen.", flush=True)

        browser.close()

if __name__ == "__main__":
    main()
