import httpx
import re

COURSES = [
    ("Nachhaltiges Wirtschaften", "course-487", "487", "6633befe-c9ab-4527-a2e4-e57a2363aeff"),
    ("Kontinuumsmechanik", "course-430", "430", "5fc90f0c-1907-4cdd-b3fe-f85cbfa93c01"),
    ("Festkörperphysik", "course-446", "446", "0b716b78-f6d6-46cd-b72e-55d65af7c371"),
    ("Allgemeine und Anorganische Chemie", "course-37", "37", "bfe63718-537f-4041-ac5c-98bb8c2c994e"),
    ("Elektronik – Bauelemente und analoge Schaltungen", "course-48", "48", "da27ee8e-6d86-4e40-b9e4-d136d3fc7c72")
]

def scan():
    print("=== Kladaba Kurs-Scan (Fachschaft TF Freiburg) ===")
    for name, cid, num, nlm_id in COURSES:
        url = f"https://db.fachschaft.tf/submission/?course={num}"
        try:
            r = httpx.get(url, follow_redirects=True, timeout=15)
            subs = re.findall(r'/submission/(\d+)/', r.text)
            subs = sorted(list(set(subs)), key=lambda x: int(x), reverse=True)
            print(f"\nFach: {name} (Kladaba #{num})")
            print(f"  Gefundene Submissions: {len(subs)}")
            print(f"  NotebookLM Notebook ID: {nlm_id}")
            print(f"  Neueste Submission-IDs: {subs[:5]}")
        except Exception as e:
            print(f"\nFehler beim Abruf für {name}: {e}")

if __name__ == "__main__":
    scan()
