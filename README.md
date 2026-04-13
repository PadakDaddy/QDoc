# QDoc

**QDoc (Queue + Doctor)** is a smart queue and check‑in system designed
for walk‑in clinics.

Instead of waiting in crowded clinic waiting rooms, patients can **join
a queue remotely, monitor their position in real time, and arrive just
before their turn**.

This improves patient safety, reduces congestion in clinics, and
provides a better waiting experience.

------------------------------------------------------------------------

# Problem

Walk‑in clinics often have **long wait times and crowded waiting
rooms**.

Patients may wait for hours in shared spaces, which increases discomfort
and potential health risks.

QDoc solves this by allowing patients to:

-   join a queue remotely
-   track their position in real time
-   arrive only when their turn is approaching

------------------------------------------------------------------------

# Features

### Hospital Search

Find nearby hospitals and compare queue conditions.

### Remote Queue Check‑in

Join a hospital queue directly from the web app.

### Live Queue Monitoring

Real‑time queue updates using **WebSocket** with polling fallback.

### Queue Notifications

Receive a notification when your turn is approaching.

### Privacy‑First Authentication

Secure authentication powered by **Auth0**.

------------------------------------------------------------------------

# System Architecture

    Patient Web App (React)
            │
            ▼
    Backend API (NestJS)
            │
     ┌──────┴─────────┐
     │                │
    Queue Logic   WebSocket Server
     │                │
     ▼                ▼
    SQL Server     Real‑time Updates

A separate **Hospital Management App (WPF)** simulates the clinic‑side
interface.

------------------------------------------------------------------------

# Tech Stack

## Frontend

-   React
-   Vite
-   React Router

## Backend

-   NestJS
-   Prisma ORM
-   SQL Server
-   Socket.IO

## Hospital App

-   C# WPF (.NET 10)

## Authentication

-   Auth0

------------------------------------------------------------------------

# Repository Structure

    frontend/
        Customer web application

    backend/
        API server
        Queue logic
        WebSocket server
        Symptom analysis
        UiPath endpoints

    hospital-wpf/
        Windows hospital demo application

------------------------------------------------------------------------

# Quick Start

## 1. Start the Backend

Create `.env` from `backend/.env.example` and configure:

``` env
DATABASE_URL="sqlserver://localhost:1433;database=QDoc;user=<UserName>;password=<Password>;encrypt=false;trustServerCertificate=true"
HOST=0.0.0.0
PORT=4000
CORS_ORIGIN="http://localhost:5173"
AUTH_DEV_BYPASS=true
AUTH0_ISSUER=""
AUTH0_AUDIENCE=""
AUTH0_JWKS_URI=""
```

Run the backend:

``` bash
cd backend
npm install
npm run prisma:generate
npm run db:reset
npm run start:dev
```

Backend API:

    http://localhost:4000/api

------------------------------------------------------------------------

## 2. Start the Frontend

Create `frontend/.env` from `frontend/.env.example`.

For local development authentication:

``` env
VITE_AUTH_BYPASS=true
VITE_API_PORT=4000
```

Run:

``` bash
cd frontend
npm install
npm run dev
```

Web application:

    http://localhost:5173

------------------------------------------------------------------------

## 3. Run the Hospital WPF Demo (Optional)

Open the solution in Visual Studio:

    QDoc.sln

Run:

    QDocHospitalApp

Or build from CLI:

``` bash
dotnet build hospital-wpf/QDocHospitalApp/QDocHospitalApp.csproj
```

------------------------------------------------------------------------

# Authentication Modes

## Development Mode

For fast local testing without Auth0.

Frontend:

    VITE_AUTH_BYPASS=true

Backend:

    AUTH_DEV_BYPASS=true

Features enabled:

-   local account login
-   guest user shortcut
-   development auth headers

------------------------------------------------------------------------

## Auth0 Mode

Use this for production‑style authentication.

Frontend:

``` env
VITE_AUTH_BYPASS=false
VITE_AUTH0_DOMAIN=<your-auth0-domain>
VITE_AUTH0_CLIENT_ID=<your-auth0-spa-client-id>
VITE_AUTH0_AUDIENCE=<your-api-audience>
VITE_AUTH0_SCOPE=openid profile email
```

Backend:

``` env
AUTH_DEV_BYPASS=false
AUTH0_ISSUER="https://<your-auth0-domain>/"
AUTH0_AUDIENCE="<your-api-audience>"
AUTH0_JWKS_URI="https://<your-auth0-domain>/.well-known/jwks.json"
```

Auth0 application settings:

    Allowed Callback URLs:
    http://localhost:5173/login

    Allowed Logout URLs:
    http://localhost:5173/login

    Allowed Web Origins:
    http://localhost:5173

------------------------------------------------------------------------

# Typical Demo Flow

1.  Open the web application
2.  Sign in
3.  Search nearby hospitals
4.  Click **Check in**
5.  Complete queue registration
6.  Monitor live queue status
7.  Return to the home screen and confirm **My Queue Status**

------------------------------------------------------------------------

# Project Goal

QDoc demonstrates how modern web technologies can improve **healthcare
accessibility and waiting room safety**.

By enabling **remote queue management**, clinics can reduce congestion
while patients enjoy a safer and more convenient waiting experience.
