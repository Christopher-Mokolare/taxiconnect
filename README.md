# 🚕 TaxiConnect

Demand-driven taxi dispatch system for rural villages.

## Overview

TaxiConnect connects passengers, drivers, and conductors in a real-time taxi dispatch system. Passengers signal waiting, conductors see demand, drivers fill taxis.

## Features

- 🎛 Conductor Dashboard — Real-time taxi and passenger monitoring
- 🚗 Driver PWA — Go live, update passenger count, offline support
- 👤 Passenger App — Request taxi, see available seats
- 🔐 Phone authentication (SMS OTP)
- 📱 PWA — Installable on mobile devices

## Routes

- 🏘 Sun City (Sun Village)
- 🏙 Rustenburg (Town)

## Tech Stack

- Firebase Realtime Database
- Firebase Authentication (Phone)
- Firebase Hosting
- Firebase Cloud Functions
- Vanilla JS + HTML/CSS

## Project Structure

```
├── public/
│   ├── index.html              # Landing page
│   ├── conductor.html          # Conductor dashboard
│   ├── driver.html             # Driver PWA
│   ├── passenger.html          # Passenger PWA
│   ├── driver-manifest.json    # PWA manifest
│   └── passenger-manifest.json # PWA manifest
├── firebase/
│   ├── database.rules.json     # Security rules
│   └── functions/index.js      # Cloud Functions
├── lib/                        # Flutter/Dart source
├── .env.example                # Environment variable template
└── firebase.json
```

## Setup

```bash
# Clone the repo
git clone https://github.com/obakengBotsZA/taxiconnect.git
cd taxiconnect

# Copy and fill in environment variables
cp .env.example .env.production

# Install dependencies
npm install
cd firebase/functions && npm install
```

## Deployment

```bash
# Deploy database rules
firebase deploy --only database

# Deploy hosting
firebase deploy --only hosting

# Deploy functions (requires Blaze plan)
firebase deploy --only functions
```

## Live Demo

🚀 https://taxiconnect-dev.web.app

## License

MIT
