import httpx
import re
import json
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import unquote

AUTH_FILE = Path(__file__).parent / "kladaba_cookies.json"
LEGACY_AUTH_FILE = Path(r"C:\Users\joshu\.gemini\antigravity\brain\08b459c5-87e9-4517-9bf4-f08f224b556c\scratch\kladaba_cookies.json")
BASE_DOWNLOAD_DIR = Path(r"C:\Users\joshu\Downloads\Kladaba")

COURSES = [
    {
        "name": "Nachhaltiges Wirtschaften",
        "cid": "487",
        "notebook_id": "6633befe-c9ab-4527-a2e4-e57a2363aeff"
    },
    {
        "name": "Kontinuumsmechanik",
        "cid": "430",
        "notebook_id": "5fc90f0c-1907-4cdd-b3fe-f85cbfa93c01"
    },
    {
        "name": "Festkörperphysik",
        "cid": "446",
        "notebook_id": "0b716b78-f6d6-46cd-b72e-55d65af7c371"
    },
    {
        "name": "Allgemeine und Anorganische Chemie",
        "cid": "37",
        "notebook_id": "bfe63718-537f-4041-ac5c-98bb8c2c994e"
    },
    {
        "name": "Elektronik – Bauelemente und analoge Schaltungen",
        "cid": "48",
        "notebook_id": "da27ee8e-6d86-4e40-b9e4-d136d3fc7c72"
    }
]

def load_cookies():
    cookie_path = AUTH_FILE if AUTH_FILE.exists() else LEGACY_AUTH_FILE
    if not cookie_path.exists():
        raise FileNotFoundError(f"Keine Kladaba-Cookies gefunden. Bitte führe zuerst 'python kladaba_login.py' aus.")
    with open(cookie_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {c["name"]: c["value"] for c in data if "db.fachschaft.tf" in c.get("domain", "")}

def extract_year(semester_str):
    m = re.search(r'20(\d{2})', semester_str or "")
    if m:
        return int("20" + m.group(1))
    return None

def get_existing_notebook_sources(notebook_id):
    try:
        cmd = [sys.executable, "-m", "notebooklm", "source", "list", "-n", notebook_id, "--json"]
        res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
        if res.returncode == 0 and res.stdout.strip():
            parsed = json.loads(res.stdout)
            sources = parsed.get("sources", []) if isinstance(parsed, dict) else parsed
            titles = set()
            for s in sources:
                if isinstance(s, dict):
                    t = s.get("title") or s.get("name")
                    if t:
                        titles.add(t.strip().lower())
            return titles
    except Exception as e:
        print(f"Warnung beim Abrufen bestehender Quellen für {notebook_id}: {e}")
    return set()

def sanitize_filename(name):
    s = re.sub(r'[\\/*?:"<>|]', "_", name)
    return ' '.join(s.split()).strip()

def get_submissions_for_course(client, cid):
    submissions = []
    page_num = 1
    while True:
        url = f"https://db.fachschaft.tf/submission/?course={cid}&page={page_num}"
        r = client.get(url)
        if r.status_code != 200:
            break
        
        soup_rows = re.findall(r'<tr[^>]*onclick="window\.location\.href\s*=\s*\'/submission/(\d+)/\'[^>]*>([\s\S]*?)</tr>', r.text)
        if not soup_rows:
            break

        for sub_id, row_content in soup_rows:
            cells = re.findall(r'<td[^>]*>([\s\S]*?)</td>|<th[^>]*>([\s\S]*?)</th>', row_content)
            clean_cells = []
            for c1, c2 in cells:
                raw = c1 or c2
                cleaned = re.sub(r'<[^>]+>', '', raw).strip()
                cleaned = ' '.join(cleaned.split())
                if cleaned:
                    clean_cells.append(cleaned)
            
            semester = clean_cells[0] if len(clean_cells) > 0 else ""
            stype = clean_cells[1] if len(clean_cells) > 1 else ""
            course_name = clean_cells[2] if len(clean_cells) > 2 else ""
            lecturer = clean_cells[3] if len(clean_cells) > 3 else ""

            submissions.append({
                "sub_id": sub_id,
                "semester": semester,
                "type": stype,
                "course": course_name,
                "lecturer": lecturer,
                "year": extract_year(semester)
            })

        if f"page={page_num + 1}" in r.text:
            page_num += 1
        else:
            break

    return submissions

def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
    print("=== Starte automatischen Kladaba -> NotebookLM Sync (2018-2026) ===", flush=True)
    try:
        cookies = load_cookies()
    except Exception as e:
        print(f"Fehler: {e}")
        return

    client = httpx.Client(cookies=cookies, follow_redirects=True, timeout=30)

    stats = {
        "total_courses": len(COURSES),
        "total_downloaded": 0,
        "total_uploaded": 0,
        "total_skipped": 0,
        "errors": []
    }

    for c in COURSES:
        course_name = c["name"]
        cid = c["cid"]
        notebook_id = c["notebook_id"]
        course_dir = BASE_DOWNLOAD_DIR / sanitize_filename(course_name)
        course_dir.mkdir(parents=True, exist_ok=True)

        print(f"\n=======================================================", flush=True)
        print(f"▶ Fach: {course_name} (Kladaba ID {cid})", flush=True)
        print(f"  Ziel-Notebook: {notebook_id}", flush=True)
        print(f"  Lokaler Ordner: {course_dir}", flush=True)

        existing_sources = get_existing_notebook_sources(notebook_id)
        print(f"  Bereits in NotebookLM vorhanden: {len(existing_sources)} Quellen", flush=True)

        # 1. Submissions finden
        subs = get_submissions_for_course(client, cid)
        target_subs = [s for s in subs if s["year"] is None or s["year"] >= 2018]
        print(f"  Gefundene Submissions (2018-2026): {len(target_subs)} von {len(subs)}", flush=True)

        # 2. Downloads und Uploads
        for idx, sub in enumerate(target_subs, 1):
            sub_id = sub["sub_id"]
            sem = sub["semester"] or "Ohne-Semester"
            stype = sub["type"] or "Dokument"
            lecturer = sub["lecturer"] or ""
            print(f"\n  [{idx}/{len(target_subs)}] Submission #{sub_id}: {sem} | {stype} ({lecturer})", flush=True)

            sub_url = f"https://db.fachschaft.tf/submission/{sub_id}/"
            try:
                r = client.get(sub_url)
                if r.status_code != 200:
                    print(f"    Fehler beim Aufrufen von {sub_url} (HTTP {r.status_code})", flush=True)
                    continue
                
                dl_ids = re.findall(r'/download/(\d+)', r.text)
                dl_ids = sorted(list(set(dl_ids)))
                if not dl_ids:
                    print("    Keine Download-Links gefunden.", flush=True)
                    continue

                for dl_id in dl_ids:
                    dl_url = f"https://db.fachschaft.tf/download/{dl_id}"
                    
                    dl_resp = client.get(dl_url)
                    if dl_resp.status_code != 200:
                        print(f"    Download {dl_id} fehlgeschlagen (HTTP {dl_resp.status_code})", flush=True)
                        continue

                    # Filename
                    cd = dl_resp.headers.get("content-disposition", "")
                    fname = None
                    m = re.search(r'filename\*?=(?:UTF-8\'\')?["\']?([^"\';]+)["\']?', cd)
                    if m:
                        fname = unquote(m.group(1))
                    
                    if not fname:
                        fname = f"{sem}_{stype}_{sub_id}_{dl_id}.pdf"

                    fname = sanitize_filename(fname)
                    if not re.search(r'\.[a-zA-Z0-9]+$', fname):
                        fname += ".pdf"

                    target_file = course_dir / fname
                    if not target_file.exists():
                        target_file.write_bytes(dl_resp.content)
                        size_kb = len(dl_resp.content) / 1024
                        print(f"    Heruntergeladen: {fname} ({size_kb:.1f} KB)", flush=True)
                        stats["total_downloaded"] += 1
                    else:
                        print(f"    Bereits lokal vorhanden: {fname}", flush=True)

                    # Check if already in NotebookLM
                    clean_title = fname.lower()
                    if clean_title in existing_sources or fname.replace(".pdf", "").lower() in existing_sources:
                        print(f"    Bereits in NotebookLM: {fname} (Überspringe Upload)", flush=True)
                        stats["total_skipped"] += 1
                        continue

                    # Upload to NotebookLM
                    print(f"    Lade hoch nach NotebookLM...", flush=True)
                    cmd = [sys.executable, "-m", "notebooklm", "source", "add", str(target_file), "-n", notebook_id, "--json"]
                    up_res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
                    if up_res.returncode == 0:
                        print(f"    Erfolgreich hochgeladen!", flush=True)
                        stats["total_uploaded"] += 1
                        existing_sources.add(clean_title)
                    else:
                        err_msg = f"Fehler beim Upload von {fname}: {up_res.stderr.strip() or up_res.stdout.strip()}"
                        print(f"    {err_msg}", flush=True)
                        stats["errors"].append(err_msg)

                    time.sleep(1)

            except Exception as ex:
                err_msg = f"Fehler bei Submission {sub_id}: {ex}"
                print(f"    {err_msg}", flush=True)
                stats["errors"].append(err_msg)

            time.sleep(0.5)

    print("\n=======================================================", flush=True)
    print("=== SYNC ABGESCHLOSSEN ===", flush=True)
    print(f"Heruntergeladene Dateien: {stats['total_downloaded']}")
    print(f"In NotebookLM hochgeladen: {stats['total_uploaded']}")
    print(f"Bereits vorhandene / übersprungene: {stats['total_skipped']}")
    if stats["errors"]:
        print(f"Fehler aufgetreten: {len(stats['errors'])}")
        for e in stats["errors"][:5]:
            print(f"  - {e}")

if __name__ == "__main__":
    main()
