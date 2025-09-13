# Protection Civile — Habillement (Flask SPA)

- Backend : Flask + SQLAlchemy + Flask-Login (servi par Gunicorn)
- DB : Postgres 16
- Front : Single Page (index.html + app.js + app.css)
- Public QR par antenne : `/a/<antenna_id>`

## Lancer en local / serveur
```bash
docker compose up --build -d
```

- Backend direct : `http://<host>:8010/`
- Admin par défaut : `admin@pc.fr / admin123`

## Variables d'environnement
Voir `.env.example`. Par défaut, `docker-compose.yml` définit les valeurs nécessaires.

## Nginx existant
Collez `nginx-example.conf` dans votre configuration et adaptez `server_name`.
