# How to fix environment issues

Below are common environment-related issues and how to address them.

1) The "EnvironmentNameNotFound" error when referencing azureml_py38:
   - This happens if you attempt to activate (or run) a conda environment that doesn't actually exist on your system. Make sure you create or select the correct environment. For example:
     
     conda create -n azureml_py38 python=3.8
     conda activate azureml_py38

   - Alternatively, remove the reference to azureml_py38 if you're not actually using that environment. Ensure your environment file or your deployment scripts reference a valid existing environment.

2) "No supported WebSocket library detected" warnings:
   - Uvicorn can run without WebSockets, but for routes ending with "/ws/..." or for real-time data exchange, you'll need a WebSocket library.  
   - Install one of:  
       pip install "uvicorn[standard]"  
     (includes websockets), or install a library like websockets or wsproto separately:
       pip install websockets

3) Invalid Azure OpenAI credentials:
   - The server logs “Azure OpenAI endpoint or key is not configured.” Provide the required environment variables, for example in a .env file or system environment:
     
     AZURE_OPENAI_ENDPOINT=https://YOUR-ENDPOINT-NAME.openai.azure.com
     AZURE_OPENAI_KEY=YOUR-SECRET-KEY

   - Make sure these are actually set, either in your production environment or locally. You can check with commands like:
     
     echo $AZURE_OPENAI_ENDPOINT (Linux/macOS)
     echo %AZURE_OPENAI_ENDPOINT% (Windows)

After correcting your environment reference, installing a WebSocket library, and providing the correct Azure OpenAI credentials, the application should run without these errors.
