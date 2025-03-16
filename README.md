# azure_chatapp

## Production Deployment
```bash
docker build -t chat-app .
docker run -d -p 80:80 -e DATABASE_URL=... -e AZURE_OPENAI_KEY=... chat-app
```
