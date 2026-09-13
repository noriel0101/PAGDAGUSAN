<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# BoardEase

## Run Locally

Prerequisites: Node.js and PostgreSQL with pgAdmin 4.

1. Install PostgreSQL, open pgAdmin 4, and create a database named `boardease`.
2. Copy `server/.env.example` to `server/.env` and set the PostgreSQL password and a JWT secret.
3. In pgAdmin Query Tool, run `database/schema.sql`.
4. Seed the demo data with `npm run db:seed`.
5. Install dependencies with `npm install`.
6. Start the API with `npm run server`.
7. In another terminal, start the frontend with `npm run dev`.
8. Open `http://localhost:3000`.

For local testing, the seeded accounts use the development password `boardease-demo`. Change these credentials before using the app outside local development.

pgAdmin 4 is the management interface; PostgreSQL is the database server. Refreshing the application reads records from PostgreSQL through Express. You can verify changes in pgAdmin by refreshing the relevant table view.

Use `npm run dev:full` to start both processes together. Use `npm run build` for a production frontend build and `npm run lint` for TypeScript validation.
