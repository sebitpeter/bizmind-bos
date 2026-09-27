# BizMind BOS
Intelligent Business Operating System for SMEs — MVP.

## Stack
- Frontend: Next.js + TypeScript + Tailwind CSS
- Backend: Node.js + Express + Prisma + SQLite
- AI: Python + FastAPI + pandas

## Run
### 1. Backend
cd backend
npm install
copy .env.example .env
npx prisma generate
npx prisma migrate dev --name init
npm run dev

### 2. Frontend
cd frontend
npm install
copy .env.local.example .env.local
npm run dev

Open http://localhost:3000

### 3. AI service
cd ml-service
python -m venv .venv
.venv\\Scripts\\activate   # Windows PowerShell: .venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

Backend: http://localhost:4000
AI: http://localhost:8000
