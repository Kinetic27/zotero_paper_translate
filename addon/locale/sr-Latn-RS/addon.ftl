service-google = Google
service-googleapi = Google(API)
service-bing = Bing
service-deeplx = DeepLX
service-chatgpt = ChatGPT
service-claude = Claude
service-gemini = Gemini
service-codex = OpenAI Auth
service-codex-model = Model
service-codex-effort = Nivo razmišljanja
service-codex-automatic = Automatski: prvi dostupni model
service-codex-default-effort = Podrazumevano: podešavanje modela
service-codex-loading = Učitavanje modela naloga…
service-codex-signin-required = Prijavi se da bi se učitali tvoji modeli.
service-codex-signing-in = Dovrši prijavu u pregledaču.
service-codex-unavailable = Nedostupno: { $value }
service-codex-selection-invalid = Proveri nalog i modele, pa izaberi dostupni model i podržani nivo razmišljanja pre čuvanja
service-codex-loaded = Dostupno modela: { $count }
service-codex-login = Prijavi se pomoću ChatGPT-a
service-codex-status = Proveri nalog i modele
service-codex-cancel-login = Otkaži prijavljivanje
service-codex-logout = Odjavi se
service-codex-hint = Izaberi model i nivo razmišljanja, pa sačuvaj.

service-bingdict = Bing rečnik (en→zh)🔊
service-cambridgedict = Cambridge rečnik (en→other)🔊
service-haicidict = Haici rečnik (en→zh)🔊
service-collinsdict = Collins rečnik (en→zh)🔊
service-youdaodict = Youdao rečnik (en→zh)🔊
service-freedictionaryapi = FreeDictionaryAPI(en→en)
service-webliodict = Weblio rečnik (en→ja)
service-gramotadict = Gramota.ru(ru)
service-errorPrefix = [Greška zahteva]
    Servis nije dostupan, tajni ključ nije ispravan ili se zahtevi šalju prebrzo.
    Koristi drugi prevodilački servis ili prijavi problem ovde:
    https://github.com/windingwind/zotero-pdf-translate/issues

    Poruka ispod ne dolazi od Zotera ni dodatka Translate, već od servisa
service-dialog-config = Podešavanja
service-dialog-title = Podešavanja servisa { $service }
service-dialog-save = Sačuvaj
service-dialog-close = Zatvori
service-dialog-help = Pomoć
service-dialog-custom-request-description = Pogledaj API dokumentaciju pružaoca servisa i dodaj prilagođene parametre. Oni će biti spojeni sa uobičajenim parametrima (model, messages, temperature, stream).
service-dialog-custom-request-title = Prilagođeni parametri zahteva
service-dialog-custom-request-add-param = Dodaj parametar
service-dialog-custom-request-parameter-name = Naziv parametra
service-dialog-custom-request-parameter-value = Vrednost parametra
service-dialog-custom-request-parameter-name-placeholder = Naziv parametra
service-dialog-custom-request-parameter-value-placeholder = Vrednost parametra (JSON format)
service-dialog-custom-request-validation-title = Prilagođeni parametri ne mogu da se sačuvaju
service-dialog-custom-request-validation-summary = Neke vrednosti parametara nisu ispravan JSON. Ispravi ih i pokušaj ponovo.
service-dialog-custom-request-validation-errors-head = Proveri sledeće:
service-dialog-custom-request-validation-error-invalid = - { $key }: neispravan format ({ $detail })
service-dialog-custom-request-validation-error-empty = - { $key }: vrednost je prazna
service-dialog-custom-request-validation-error-duplicate = - { $key }: naziv parametra se ponavlja
service-dialog-custom-request-validation-examples-head = Primeri vrednosti:
service-dialog-custom-request-validation-example-boolean = - Logička vrednost: false
service-dialog-custom-request-validation-example-number = - Broj: 123
service-dialog-custom-request-validation-example-string = - Tekst: "text"
service-dialog-custom-request-validation-example-object = - Objekat: { $example }
service-dialog-api-format-openai = OpenAI (chat/completions)
service-dialog-api-format-anthropic = Anthropic (messages)
service-gpt-dialog-thinkingLevel-hint = Format parametra razmišljanja se automatski prepoznaje prema adresi servisa (OpenAI/Azure, OpenRouter, GLM, DeepSeek, Kimi, Doubao, Qwen). Za nepoznate adrese (npr. relay) ne šalje se nijedan parametar: postavi ga ručno preko „Prilagođeni zahtev“.
service-dialog-thinking-default = Podrazumevano
service-dialog-thinking-off = Isključeno
service-dialog-thinking-low = Nisko
service-dialog-thinking-medium = Srednje
service-dialog-thinking-high = Visoko

service-deeplx-dialog-endPoint = Adresa API-ja

service-chatgpt-dialog-endPoint = Osnovni URL API-ja
service-chatgpt-dialog-model = ID modela
service-chatgpt-dialog-temperature = Temperatura
service-chatgpt-dialog-apiFormat = Format API-ja
service-chatgpt-dialog-prompt = Uputstvo
service-gpt-dialog-prompt-hint = Dostupne promenljive: { $variables }. { $required } je obavezna.
service-gpt-dialog-prompt-required = Dodajte { $placeholder } da bi izabrani tekst mogao da se pošalje na prevođenje.
service-gpt-dialog-apiFormat-hint = Ovaj jedan ChatGPT servis prihvata OpenAI-kompatibilne (chat/completions) i Anthropic-kompatibilne (messages) adrese. Izaberi format koji navodi dokumentacija pružaoca, pa unesi njegov osnovni URL API-ja, na primer https://api.deepseek.com ili https://api.openai.com/v1; kompletan URL resursa koristi se onako kako je upisan. Polje modela prima ID modela pružaoca. Unesi API ključ posebno u polje za tajni ključ izabranog servisa. Šalje se neizmenjen u zaglavlju koje izabrani format zahteva, pa nije potrebna sintaksa ključa specifična za pružaoca.
service-chatgpt-dialog-stream = Tok odgovora
service-chatgpt-dialog-thinkingLevel = Razmišljanje
service-chatgpt-dialog-custom-request = Prilagođeni zahtev

service-gemini-dialog-endPoint = Osnovni URL API-ja (bez /models/model)
service-gemini-dialog-model = ID modela
service-gemini-dialog-prompt = Uputstvo
service-gemini-dialog-stream = Tok odgovora
service-gemini-dialog-thinkingLevel = Razmišljanje

service-claude-dialog-endPoint = Osnovni URL API-ja
service-claude-dialog-model = ID modela
service-claude-dialog-temperature = Temperatura
service-claude-dialog-prompt = Uputstvo
service-claude-dialog-stream = Tok odgovora
service-claude-dialog-thinkingLevel = Razmišljanje
service-claude-dialog-maxTokens = Najviše tokena

readerpopup-translate-label = Prevedi
readerpopup-addToNote-label = Dodaj prevod u belešku

pref-title = Zotero Translation Reader

field-titleTranslation = Prevod naslova
field-abstractTranslation = Prevod sažetka

status-translating = Prevođenje...
sideBarIcon-title = Prevedi oznaku

service-manageKeys-title = Upravljanje ključevima prevodilačkih servisa
service-manageKeys-head = Upravljaj svim ključevima prevodilačkih servisa. Uredi JSON direktno i izaberi „Sačuvaj“.
service-manageKeys-save = Sačuvaj
service-manageKeys-close = Zatvori

service-renameServices-title = Preimenuj nazive servisa prilagođenog API-ja
service-renameServices-head = Unesi novi naziv za servise prilagođenog API-ja (ChatGPT, Claude, Gemini) i izaberi „Sačuvaj“.
service-renameServices-hint = Izmene važe posle ponovnog pokretanja dodatka ili Zotera
service-renameServices-save = Sačuvaj
service-renameServices-close = Zatvori
