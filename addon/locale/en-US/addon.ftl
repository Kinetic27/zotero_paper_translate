service-google=Google
service-googleapi=Google(API)
service-bing=Bing
service-deeplx=DeepLX
service-chatgpt=ChatGPT
service-claude=Claude
service-gemini=Gemini
service-codex=OpenAI Auth
service-codex-model=Model
service-codex-effort=Reasoning effort
service-codex-automatic=Automatic: first available model
service-codex-default-effort=Default: model setting
service-codex-loading=Loading account models…
service-codex-signin-required=Sign in to load your models.
service-codex-signing-in=Complete sign-in in your browser.
service-codex-unavailable=Unavailable: { $value }
service-codex-selection-invalid=Check account and models, then select an available model and supported reasoning effort before saving
service-codex-loaded={ $count } models available
service-codex-login=Sign in with ChatGPT
service-codex-status=Check account and models
service-codex-cancel-login=Cancel sign-in
service-codex-logout=Sign out
service-codex-hint=Choose a model and reasoning effort, then Save.

service-bingdict=Bing Dict(en→zh)🔊
service-cambridgedict=Cambridge Dict(en→other)🔊
service-haicidict=Haici Dict(en→zh)🔊
service-collinsdict=Collins Dict(en→zh)🔊
service-youdaodict=Youdao Dict(en→zh)🔊
service-freedictionaryapi=FreeDictionaryAPI(en→en)
service-webliodict=Weblio Dict(en→ja)
service-gramotadict=Gramota.ru(ru)
service-errorPrefix=[Request Error]
    Service not available, invalid secret, or request too fast.
    Use another translation service or post the issue here: 
    https://github.com/windingwind/zotero-pdf-translate/issues
    
    The message below is not Zotero or the Translate plugin, but from

service-dialog-config=Config
service-dialog-title={ $service } Config
service-dialog-save=Save
service-dialog-close=Close
service-dialog-help=Help
service-dialog-custom-request-description=Refer to API documentation of service provider, add custom parameters. These will be merged with the standard parameters (model, messages, temperature, stream).
service-dialog-custom-request-title=Custom Request Parameters
service-dialog-custom-request-add-param=Add Parameter
service-dialog-custom-request-parameter-name=Parameter Name
service-dialog-custom-request-parameter-value=Parameter Value
service-dialog-custom-request-parameter-name-placeholder=Parameter name
service-dialog-custom-request-parameter-value-placeholder=Parameter value (JSON format)
service-dialog-custom-request-validation-title=Can't Save Custom Parameters
service-dialog-custom-request-validation-summary=Some parameter values are not valid JSON. Please fix them and try again.
service-dialog-custom-request-validation-errors-head=Please check:
service-dialog-custom-request-validation-error-invalid=- { $key }: invalid format ({ $detail })
service-dialog-custom-request-validation-error-empty=- { $key }: value is empty
service-dialog-custom-request-validation-error-duplicate=- { $key }: duplicate parameter name
service-dialog-custom-request-validation-examples-head=Examples for the value field:
service-dialog-custom-request-validation-example-boolean=- Boolean: false
service-dialog-custom-request-validation-example-number=- Number: 123
service-dialog-custom-request-validation-example-string=- Text: "text"
service-dialog-custom-request-validation-example-object=- Object: { $example }
service-dialog-api-format-openai=OpenAI (chat/completions)
service-dialog-api-format-anthropic=Anthropic (messages)
service-gpt-dialog-thinkingLevel-hint=The thinking parameter format is auto-detected from the endpoint (OpenAI/Azure, OpenRouter, GLM, DeepSeek, Kimi, Doubao, Qwen). Nothing is sent for unrecognized endpoints (e.g. relays) — use Custom Request to set the parameter manually.
service-dialog-thinking-default=Default
service-dialog-thinking-off=Off
service-dialog-thinking-low=Low
service-dialog-thinking-medium=Medium
service-dialog-thinking-high=High

service-deeplx-dialog-endPoint=API Endpoint

service-chatgpt-dialog-endPoint=API Base URL
service-chatgpt-dialog-model=Model ID
service-chatgpt-dialog-temperature=Temp
service-chatgpt-dialog-apiFormat=API Format
service-chatgpt-dialog-prompt=Prompt
service-gpt-dialog-prompt-hint=Available variables: { $variables }. { $required } is required.
service-gpt-dialog-prompt-required=Please add { $placeholder } so the selected text can be sent for translation.
service-gpt-dialog-apiFormat-hint=This single ChatGPT service accepts both OpenAI-compatible (chat/completions) and Anthropic-compatible (messages) endpoints. Pick the format your provider documents, then enter its API base URL, for example https://api.deepseek.com or https://api.openai.com/v1; a complete resource URL is also used as typed. The model field takes the provider's model ID. Enter the API key separately in the selected service's Secret field. It is sent as-is in the header the selected format expects, so no vendor-specific key syntax is required.
service-chatgpt-dialog-stream=Stream
service-chatgpt-dialog-thinkingLevel=Thinking
service-chatgpt-dialog-custom-request=Custom Request

service-gemini-dialog-endPoint=API Base URL (without /models/model)
service-gemini-dialog-model=Model ID
service-gemini-dialog-prompt=Prompt
service-gemini-dialog-stream=Stream
service-gemini-dialog-thinkingLevel=Thinking

service-claude-dialog-endPoint=API Base URL
service-claude-dialog-model=Model ID
service-claude-dialog-temperature=Temp
service-claude-dialog-prompt=Prompt
service-claude-dialog-stream=Stream
service-claude-dialog-thinkingLevel=Thinking
service-claude-dialog-maxTokens=Max Tokens

readerpopup-translate-label=Translate
readerpopup-addToNote-label=Add Translation to Note

pref-title=Zotero Translation Reader

field-titleTranslation=Title Translation
field-abstractTranslation=Abstract Translation

status-translating=Translating...
sideBarIcon-title=Translate annotation

service-manageKeys-title=Manage Translation Service Keys
service-manageKeys-head=Manage all translation service keys. Edit the JSON directly and click Save.
service-manageKeys-save=Save
service-manageKeys-close=Close

service-renameServices-title=Rename Custom API Service Names
service-renameServices-head=Enter a new display name for the custom API services (ChatGPT, Claude, Gemini) and click Save.
service-renameServices-hint=Changes take effect after restarting the plugin or Zotero
service-renameServices-save=Save
service-renameServices-close=Close
