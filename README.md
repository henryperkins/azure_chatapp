# azure_chatapp

## Production Deployment
```bash
docker build -t chat-app .
docker run -d -p 80:80 -e DATABASE_URL=... -e AZURE_OPENAI_KEY=... chat-app
```

## Environment Variables
AZURE_OPENAI_ENDPOINT=your-resource.endpoint.azure
AZURE_OPENAI_KEY=your-api-key
JWT_SECRET=secure-random-string

## Development Setup
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
npm run dev:css
