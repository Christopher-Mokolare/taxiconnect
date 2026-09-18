# 🚕 TaxiConnect

Demand-driven taxi dispatch system connecting Sun City and Rustenburg.

## Quick Start

```bash
# Clone
git clone https://github.com/obakengBotsZA/taxiconnect.git
cd taxiconnect

# Install dependencies
cd firebase/functions && npm install && cd ../..

# Set PINs in .env file
nano firebase/functions/.env
# Edit DRIVER_PIN and CONDUCTOR_PIN

# Deploy
firebase deploy --only database,functions,hosting
