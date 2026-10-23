service-google=Google
service-googleapi=Google(API)
service-bing=Bing
service-deeplx=DeepLX
service-chatgpt=ChatGPT
service-claude=Claude
service-gemini=Gemini
service-codex=OpenAI Auth
service-codex-model=模型
service-codex-effort=推理强度
service-codex-automatic=自动：首个可用模型
service-codex-default-effort=默认：使用模型设置
service-codex-loading=正在加载账户模型…
service-codex-signin-required=登录以加载你的模型。
service-codex-signing-in=请在浏览器中完成登录。
service-codex-unavailable=不可用：{ $value }
service-codex-selection-invalid=请检查账户和模型，然后选择可用的模型和受支持的推理强度再保存
service-codex-loaded=可用模型：{ $count } 个
service-codex-login=使用 ChatGPT 登录
service-codex-status=检查账户和模型
service-codex-cancel-login=取消登录
service-codex-logout=退出登录
service-codex-hint=选择模型和推理强度，然后保存。

service-bingdict=必应词典(en→zh)🔊
service-cambridgedict=剑桥词典(en→other)🔊
service-haicidict=海词词典(en→zh)🔊
service-collinsdict=科林斯词典(en→zh)🔊
service-youdaodict=有道词典(en→zh)🔊
service-freedictionaryapi=FreeDictionaryAPI(en→en)
service-webliodict=Weblio Dict(en→ja)
service-gramotadict=Gramota.ru(ru)
service-errorPrefix=[请求错误]
    此翻译服务不可用，可能是密钥错误，也可能是请求过快。
    可以尝试其他翻译服务，或者来此查看相关回答：
    https://zotero.yuque.com/staff-gkhviy/pdf-trans/age09f
    
    请注意，这些错误与 Zotero 和本翻译插件无关，由该翻译服务引起：

service-dialog-config=配置
service-dialog-title={ $service } 配置
service-dialog-save=保存
service-dialog-close=关闭
service-dialog-help=帮助
service-dialog-custom-request-description=参考服务提供商的 API 文档，添加自定义参数。这些参数将与标准参数（model、messages、temperature、stream）合并。
service-dialog-custom-request-title=自定义请求参数
service-dialog-custom-request-add-param=添加参数
service-dialog-custom-request-parameter-name=参数名称
service-dialog-custom-request-parameter-value=参数值
service-dialog-custom-request-parameter-name-placeholder=参数名称
service-dialog-custom-request-parameter-value-placeholder=参数值（JSON 格式）
service-dialog-custom-request-validation-title=无法保存自定义参数
service-dialog-custom-request-validation-summary=有些参数值不是有效的 JSON，请修改后重试。
service-dialog-custom-request-validation-errors-head=请检查以下项目：
service-dialog-custom-request-validation-error-invalid=- { $key }：格式无效（{ $detail }）
service-dialog-custom-request-validation-error-empty=- { $key }：值为空
service-dialog-custom-request-validation-error-duplicate=- { $key }：参数名重复
service-dialog-custom-request-validation-examples-head=“参数值”填写示例：
service-dialog-custom-request-validation-example-boolean=- 布尔值：false
service-dialog-custom-request-validation-example-number=- 数字：123
service-dialog-custom-request-validation-example-string=- 文本："text"
service-dialog-custom-request-validation-example-object=- 对象：{ $example }
service-dialog-api-format-openai=OpenAI（chat/completions）
service-dialog-api-format-anthropic=Anthropic（messages）
service-gpt-dialog-thinkingLevel-hint=思考参数格式按接口地址自动识别（OpenAI/Azure、OpenRouter、智谱GLM、DeepSeek、Kimi、豆包、通义）。无法识别的接口（如中转站）不会发送任何思考参数，请通过“自定义请求”手动指定。
service-dialog-thinking-default=默认
service-dialog-thinking-off=关闭
service-dialog-thinking-low=低
service-dialog-thinking-medium=中
service-dialog-thinking-high=高

service-deeplx-dialog-endPoint=接口地址

service-chatgpt-dialog-endPoint=API 基础地址
service-chatgpt-dialog-model=模型 ID
service-chatgpt-dialog-temperature=温度
service-chatgpt-dialog-apiFormat=接口格式
service-chatgpt-dialog-prompt=提示词
service-gpt-dialog-prompt-hint=可用变量：{ $variables }。翻译正文必须使用 { $required }。
service-gpt-dialog-prompt-required=请加入 { $placeholder }，否则选中的文字不会发送给翻译服务。
service-gpt-dialog-apiFormat-hint=同一个 ChatGPT 服务同时支持 OpenAI 兼容（chat/completions）和 Anthropic 兼容（messages）接口。请选择服务商文档标明的格式，然后填写其 API 基础地址，例如 https://api.deepseek.com 或 https://api.openai.com/v1；填写完整资源地址时按原样使用。模型一栏填写服务商的模型 ID。请在所选服务的“密钥”输入框中单独填写 API 密钥。密钥按所选格式放入对应的请求头原样发送，因此不需要特定厂商的密钥格式。
service-chatgpt-dialog-stream=流式输出
service-chatgpt-dialog-thinkingLevel=思考等级
service-chatgpt-dialog-custom-request=自定义请求

service-gemini-dialog-endPoint=API 基础地址（不含 /models/model）
service-gemini-dialog-model=模型 ID
service-gemini-dialog-prompt=提示词
service-gemini-dialog-stream=流式输出
service-gemini-dialog-thinkingLevel=思考等级

service-claude-dialog-endPoint=API 基础地址
service-claude-dialog-model=模型 ID
service-claude-dialog-temperature=温度
service-claude-dialog-prompt=提示词
service-claude-dialog-stream=流式输出
service-claude-dialog-thinkingLevel=思考等级
service-claude-dialog-maxTokens=最大输出长度

readerpopup-translate-label=翻译
readerpopup-addToNote-label=添加翻译至笔记

pref-title=Zotero Translation Reader

field-titleTranslation=标题翻译
field-abstractTranslation=摘要翻译

status-translating=正在翻译...
sideBarIcon-title=翻译注释

service-manageKeys-title=管理翻译服务密钥
service-manageKeys-head=管理所有翻译服务密钥，直接编辑 JSON 文件并点击保存。
service-manageKeys-save=保存
service-manageKeys-close=关闭

service-renameServices-title=重命名自定义 API 服务名称
service-renameServices-head=为自定义 API 服务（ChatGPT、Claude、Gemini）输入新的显示名称并点击保存。
service-renameServices-hint=所做更改将在插件或 Zotero 重启后生效
service-renameServices-save=保存
service-renameServices-close=关闭
