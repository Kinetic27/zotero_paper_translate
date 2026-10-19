service-google=Google
service-googleapi=Google(API)
service-bing=Bing
service-deeplx=DeepLX
service-chatgpt=ChatGPT
service-claude=Claude
service-gemini=Gemini
service-codex=OpenAI Auth
service-codex-model=Modello
service-codex-effort=Sforzo di ragionamento
service-codex-automatic=Automatico: primo modello disponibile
service-codex-default-effort=Predefinito: impostazione del modello
service-codex-loading=Caricamento dei modelli dell'account…
service-codex-signin-required=Accedi per caricare i tuoi modelli.
service-codex-signing-in=Completa l'accesso nel browser.
service-codex-unavailable=Non disponibile: { $value }
service-codex-selection-invalid=Verifica account e modelli, poi seleziona un modello disponibile e uno sforzo di ragionamento supportato prima di salvare
service-codex-loaded={ $count } modelli disponibili
service-codex-login=Accedi con ChatGPT
service-codex-status=Verifica account e modelli
service-codex-cancel-login=Annulla accesso
service-codex-logout=Esci
service-codex-hint=Scegli un modello e uno sforzo di ragionamento, poi Salva.

service-bingdict=Bing Dict(en→zh)🔊
service-cambridgedict=Cambridge Dict(en→other)🔊
service-haicidict=Haici Dict(en→zh)🔊
service-collinsdict=Collins Dict(en→zh)🔊
service-youdaodict=Youdao Dict(en→zh)🔊
service-freedictionaryapi=FreeDictionaryAPI(en→en)
service-webliodict=Weblio Dict(en→ja)
service-gramotadict=Gramota.ru(ru)
service-errorPrefix=[Errore nella richiesta]
    Servizio di traduzione non disponibile, segreto non valido, o richiesta troppo rapida.
    Si prega di usare un altro servizio di traduzione o di segnalare il problema qui: 
    https://github.com/windingwind/zotero-pdf-translate/issues
    
    Il messaggio seguente non è di Zotero o dell'estensione Translate ma proviene da

service-dialog-config=Config
service-dialog-title={ $service } Config
service-dialog-save=Save
service-dialog-close=Close
service-dialog-help=Help
service-dialog-custom-request-description=Consulta la documentazione API del provider e aggiungi parametri personalizzati. Verranno uniti ai parametri standard (model, messages, temperature, stream).
service-dialog-custom-request-title=Parametri di richiesta personalizzati
service-dialog-custom-request-add-param=Aggiungi parametro
service-dialog-custom-request-parameter-name=Nome parametro
service-dialog-custom-request-parameter-value=Valore parametro
service-dialog-custom-request-parameter-name-placeholder=Nome parametro
service-dialog-custom-request-parameter-value-placeholder=Valore parametro (formato JSON)
service-dialog-custom-request-validation-title=Impossibile salvare i parametri personalizzati
service-dialog-custom-request-validation-summary=Alcuni valori dei parametri non sono JSON validi. Correggili e riprova.
service-dialog-custom-request-validation-errors-head=Controlla quanto segue:
service-dialog-custom-request-validation-error-invalid=- { $key }: formato non valido ({ $detail })
service-dialog-custom-request-validation-error-empty=- { $key }: valore vuoto
service-dialog-custom-request-validation-error-duplicate=- { $key }: nome parametro duplicato
service-dialog-custom-request-validation-examples-head=Esempi per il campo valore:
service-dialog-custom-request-validation-example-boolean=- Booleano: false
service-dialog-custom-request-validation-example-number=- Numero: 123
service-dialog-custom-request-validation-example-string=- Testo: "text"
service-dialog-custom-request-validation-example-object=- Oggetto: { $example }
service-dialog-api-format-openai=OpenAI (chat/completions)
service-dialog-api-format-anthropic=Anthropic (messages)
service-gpt-dialog-thinkingLevel-hint=Il formato del parametro di ragionamento viene rilevato automaticamente dall'endpoint (OpenAI/Azure, OpenRouter, GLM, DeepSeek, Kimi, Doubao, Qwen). Per endpoint non riconosciuti (es. relay) non viene inviato alcun parametro: usa Custom Request per impostarlo manualmente.
service-dialog-thinking-default=Predefinito
service-dialog-thinking-off=Disattivato
service-dialog-thinking-low=Basso
service-dialog-thinking-medium=Medio
service-dialog-thinking-high=Alto

service-deeplx-dialog-endPoint=Endpoint API

service-chatgpt-dialog-endPoint=URL di base API
service-chatgpt-dialog-model=ID modello
service-chatgpt-dialog-temperature=Temperatura
service-chatgpt-dialog-apiFormat=Formato API
service-chatgpt-dialog-prompt=Prompt
service-gpt-dialog-prompt-hint=Variabili disponibili: { $variables }. { $required } è obbligatorio.
service-gpt-dialog-prompt-required=Aggiungi { $placeholder } per inviare il testo selezionato al servizio di traduzione.
service-gpt-dialog-apiFormat-hint=Questo unico servizio ChatGPT accetta endpoint compatibili OpenAI (chat/completions) e compatibili Anthropic (messages). Scegli il formato indicato dalla documentazione del provider, poi inserisci il suo URL di base API, ad esempio https://api.deepseek.com o https://api.openai.com/v1; un URL di risorsa completo viene usato così com'è. Il campo modello richiede l'ID modello del provider. Inserisci la chiave API separatamente nel campo Segreto del servizio selezionato. Viene inviata così com'è nell'header previsto dal formato scelto, quindi non serve una sintassi di chiave specifica del fornitore.
service-chatgpt-dialog-stream=Stream
service-chatgpt-dialog-thinkingLevel=Ragionamento
service-chatgpt-dialog-custom-request=Custom Request

service-gemini-dialog-endPoint=URL di base API (senza /models/model)
service-gemini-dialog-model=ID modello
service-gemini-dialog-prompt=Prompt
service-gemini-dialog-stream=Stream
service-gemini-dialog-thinkingLevel=Ragionamento

service-claude-dialog-endPoint=URL di base API
service-claude-dialog-model=ID modello
service-claude-dialog-temperature=Temperatura
service-claude-dialog-prompt=Prompt
service-claude-dialog-stream=Stream
service-claude-dialog-thinkingLevel=Ragionamento
service-claude-dialog-maxTokens=Max Tokens

readerpopup-translate-label=Traduci
readerpopup-addToNote-label=Aggiungi traduzione alla nota

pref-title=Zotero Translation Reader

field-titleTranslation=Traduzione del titolo
field-abstractTranslation=Traduzione dell'Abstract

status-translating=Traduzione in corso...
sideBarIcon-title=Translate annotation

service-manageKeys-title=Gestione delle chiavi dei servizi di traduzione
service-manageKeys-head=Gestisci tutte le chiavi dei servizi di traduzione. Modifica direttamente il file JSON e clicca su Salva.
service-manageKeys-save=Salva
service-manageKeys-close=Chiudi

service-renameServices-title=Rinomina i nomi dei servizi API personalizzati
service-renameServices-head=Inserisci un nuovo nome visualizzato per i servizi API personalizzati (ChatGPT, Claude, Gemini) e clicca su Salva.
service-renameServices-hint=Le modifiche avranno effetto dopo il riavvio del plugin o di Zotero
service-renameServices-save=Salva
service-renameServices-close=Chiudi
