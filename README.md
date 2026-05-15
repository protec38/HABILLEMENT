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

### LDAP / LLDAP
L'application garde les comptes locaux et ajoute une authentification LDAP si `LDAP_ENABLED=true`.

- URL interne Docker : `ldap://lldap:3890`
- Reseau Docker externe requis : `lldap_ldap_net`
- Base utilisateurs : `ou=people,dc=apc38,dc=local`
- Base groupes : `ou=groups,dc=apc38,dc=local`
- Groupe requis par defaut : `habillement`
- Mapping role par defaut : `habillement:admin`

Le secret `LDAP_BIND_PASSWORD` se configure dans l'ecran Administration, champ `LDAP_BIND_PASSWORD (ne pas toucher sauf si changement LLDAP)`. Le diagnostic LDAP est aussi disponible depuis Administration.

## Nginx existant
Collez `nginx-example.conf` dans votre configuration et adaptez `server_name`.
