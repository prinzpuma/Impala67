window.APP_CONFIG = {
  // Erstelle in der Google Cloud Console einen OAuth-Client vom Typ "Desktop-App"
  // und trage hier Client-ID + Secret ein. Diese Datei nie committen (siehe .gitignore).
  GOOGLE_DESKTOP_CLIENT_ID: "DEINE_GOOGLE_DESKTOP_CLIENT_ID.apps.googleusercontent.com",
  // Google verlangt das Secret beim Desktop-Token-Tausch auch mit PKCE.
  // Bei Desktop-Apps gilt es laut Google nicht als echtes Geheimnis — trotzdem nicht ins Repo.
  GOOGLE_DESKTOP_CLIENT_SECRET: "GOCSPX-DEIN_SECRET"
};