# Azure Chat Application

A full-stack chat application leveraging Azure OpenAI services with JWT authentication and project-based organization.

## Features
- Real-time chat via WebSocket connections
- Azure OpenAI integration with streaming responses
- JWT authentication with refresh tokens
- Project management with file attachments
- Tailwind CSS with custom theme configuration
- FastAPI backend with SQLAlchemy ORM
- Redis caching for performance
- Docker-based CI/CD pipeline

## Project Structure
```
azure_chatapp/
├── models/           # Database models
│   ├── chat.py       # Chat sessions and messages
│   ├── user.py       # User authentication
│   ├── project.py    # Project metadata
│   ├── chat_project.py # Chat-project relationships
│   └── project_file.py # Project file attachments
├── routes/           # API endpoints
│   ├── auth.py       # Authentication routes
│   ├── chat.py       # Chat operations
│   └── project_routes.py # Project management
├── static/           # Frontend assets
│   ├── js/           # ES6 modules
│   │   ├── auth.js   # Token management
│   │   ├── chat.js   # WebSocket handling
│   │   └── project.js # Project UI logic
│   └── css/          # Tailwind styles
└── utils/            # Shared utilities
    ├── auth_deps.py  # JWT middleware
    └── openai.py     # Azure client

## Core API Endpoints

### Authentication
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword"
}

Response:
{
  "access_token": "jwt.token.here",
  "refresh_token": "refresh.token.here",
  "expires_in": 3600,
  "token_type": "bearer"
}
```

### Project Management
```http
POST /api/projects
Content-Type: application/json
Authorization: Bearer {token}

{
  "name": "AI Research",
  "description": "Market analysis project"
}

Response:
{
  "id": 123,
  "name": "AI Research",
  "description": "Market analysis project",
  "created_at": "2025-03-16T22:38:22Z"
}

GET /api/projects/123
Authorization: Bearer {token}

Response:
{
  "id": 123,
  "name": "AI Research",
  "description": "Market analysis project",
  "attached_chats": ["chat_abc123"],
  "files": ["report.pdf"]
}
```

### Real-time Chat
```http
WebSocket wss://yourapp.com/chat
Headers:
Authorization: Bearer {token}

Message Format:
{
  "project_id": 123,
  "message": "Analyze Q4 trends",
  "context": {"temperature": 0.7}
}

Response Stream:
{
  "content": "Q4 shows 15% growth...",
  "tokens_used": 42,
  "is_complete": false
}
```

## Deployment
```bash
# Build production image
docker build -t chat-app:prod --target production .

# Run with environment variables
docker run -d -p 80:80 \
  -e DATABASE_URL="postgresql://user:pass@db:5432/chatdb" \
  -e REDIS_URL="redis://redis:6379" \
  -e AZURE_OPENAI_KEY="your-key-here" \
  chat-app:prod
```

## Development Setup
```bash
# Backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Frontend
npm install
npm run dev:css -- --watch

# Start services
flask run --port 5000 --debug
```

## Contributing
1. Create feature branch: `git checkout -b feature/your-idea`
2. Commit changes: `git commit -am 'Add awesome feature'`
3. Push branch: `git push origin feature/your-idea`
4. Open pull request

[Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message.]
