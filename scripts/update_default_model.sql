-- Update all existing projects to use Claude 3 Sonnet as the default model
UPDATE projects SET default_model = 'claude-3-sonnet-20240229';

-- Update all existing conversations to use Claude 3 Sonnet if they're using default models
UPDATE conversations SET model_id = 'claude-3-sonnet-20240229' WHERE model_id IN ('gpt-4', 'o1');

-- Update the SQL server_default for future projects
ALTER TABLE projects ALTER COLUMN default_model SET DEFAULT 'claude-3-sonnet-20240229';