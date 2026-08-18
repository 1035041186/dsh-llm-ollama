// Client half of @zhangyi/dsh-llm-ollama: a whole-page "Ollama" settings
// section (the `settings.section` list slot), so the plugin needs no
// modification of dsh's own packages. The page manages the `llm-ollama`
// settings namespace (provider profiles) through the wire API, fetches models
// from the Ollama server through the host plugin's /api/tags discovery, and
// edits per-model Context window / Max output tokens (which the host adapter
// sends as num_ctx / num_predict).
window.__ModuleLoader__.load({
	id: "@zhangyi/dsh-llm-ollama",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		const NS = "llm-ollama";
		const OLLAMA_API = "ollama-chat";
		const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
		const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)\s*([kKmM]?)$/;
		// K and M count as 1024-based here so "32K" parses to the exact 32K
		// (32768) default the host adapter sends as num_ctx.
		const CAPACITY_SCALE = { k: 1024, m: 1024 * 1024 };

		/** Parse a capacity field ("32K", "4096", "1M"); blank -> undefined, unreadable -> NaN. */
		function parseCapacity(text) {
			const trimmed = text.trim();
			if (trimmed.length === 0) return void 0;
			const match = CAPACITY_PATTERN.exec(trimmed);
			if (match === null) return NaN;
			const suffix = match[2]?.toLowerCase();
			const scale = suffix === "k" || suffix === "m" ? CAPACITY_SCALE[suffix] : 1;
			return Number(match[1]) * scale;
		}
		/** Spell a stored capacity ("32768" -> "32K"). */
		function formatCapacity(value) {
			if (!Number.isInteger(value) || value <= 0) return String(value);
			if (value % CAPACITY_SCALE.m === 0) return `${String(value / CAPACITY_SCALE.m)}M`;
			if (value % CAPACITY_SCALE.k === 0) return `${String(value / CAPACITY_SCALE.k)}K`;
			return String(value);
		}
		function stringOf(value) {
			return typeof value === "string" ? value : "";
		}
		function numberTextOf(value) {
			return typeof value === "number" ? String(value) : "";
		}
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/** Derive the conventional credential ref for a route (mirrors the Models page). */
		function deriveKeyRef(provider) {
			return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
		}

		/** Disclosure chevron; rotates to point down while its row is open (same glyph as the Models page). */
		function IconChevron({ open }) {
			return react.createElement("svg", {
				width: "14",
				height: "14",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true,
				style: {
					transform: open ? "rotate(90deg)" : void 0,
					transition: "transform 120ms ease"
				}
			}, react.createElement("path", {
				d: "M6 3.5L10.5 8L6 12.5",
				stroke: "currentColor",
				strokeWidth: "1.5",
				strokeLinecap: "round",
				strokeLinejoin: "round"
			}));
		}
		/** Removal glyph for one model row (same glyph as the Models page). */
		function IconTrash() {
			return react.createElement("svg", {
				width: "14",
				height: "14",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true
			}, react.createElement("path", {
				d: "M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4",
				stroke: "currentColor",
				strokeWidth: "1.3",
				strokeLinecap: "round",
				strokeLinejoin: "round"
			}));
		}

		/** Copy dictionaries for the Ollama settings section. */
		const en = {
			nav: "Ollama",
			title: "Ollama",
			intro: "Configure Ollama providers. Each provider talks to an Ollama server through its native /api/chat protocol.",
			readOnly: "The settings document is read-only in this deployment.",
			loadFailed: "Loading the Ollama configuration failed",
			retry: "Retry",
			add: "Add provider",
			route: "Provider ID",
			routeHint: "Lowercase identifier, starting with a letter, that uniquely names this provider.",
			routeInvalid: "Start with a lowercase letter; then lowercase letters, digits, and dashes.",
			routeTaken: "A provider already uses this ID.",
			displayName: "Display name",
			baseUrl: "Base URL",
			baseUrlPlaceholder: "http://localhost:11434",
			baseUrlHint: "Ollama's native API base — the default local server is http://localhost:11434.",
			baseUrlRequired: "A provider needs a base URL.",
			keepAlive: "Keep alive (model stay-loaded duration)",
			temperature: "Temperature",
			temperatureInvalid: "Temperature must be a number between 0 and 2.",
			keyInput: "API key",
			keyPlaceholder: "Optional — Ollama usually needs no key",
			models: "Models",
			modelsEmpty: "No models yet. Fetch them from the server or add them by hand.",
			fetchModels: "Fetch available models",
			fetching: "Asking the server…",
			fetchNeedsBaseUrl: "Enter the base URL first, then fetch.",
			fetchEmpty: "The server listed no models. Add them by hand.",
			fetchTitle: "Choose models to add",
			fetchDescription: "These are the models this provider has available. Choose the ones to add.",
			fetchAdopt: "Add selected",
			cancel: "Cancel",
			close: "Close",
			addModel: "Add model",
			removeModel: "Delete model",
			modelId: "Model ID",
			modelName: "Display name",
			contextWindow: "Context window",
			maxTokens: "Max output tokens",
			ollamaNumCtxHint: "Ollama sends each model's Context window as the num_ctx request option and Max output tokens as num_predict — whatever you enter here is passed to the API exactly.",
			modelInvalid: "Each model needs a unique ID; capacities must be positive counts like 4096, 32K, or 1M.",
			save: "Save",
			saving: "Saving…",
			saved: "Saved.",
			delete: "Delete",
			deleteConfirm: "Delete this provider?",
			deleting: "Deleting…",
			notConfigured: "Not configured yet — fill in the fields and save.",
			configured: "Configured",
			custom: "Custom",
			conflict: "These settings changed while the card was open. Reload and retry.",
			expandCapacities: "Capacities"
		};
		const zh = {
			nav: "Ollama",
			title: "Ollama",
			intro: "配置 Ollama 提供方。每个提供方通过其原生 /api/chat 协议连接一台 Ollama 服务器。",
			readOnly: "当前部署的设置文档为只读。",
			loadFailed: "加载 Ollama 配置失败",
			retry: "重试",
			add: "添加提供方",
			route: "Provider ID",
			routeHint: "以小写字母开头的标识，在请求中唯一标识该提供方。",
			routeInvalid: "需以小写字母开头，之后可用小写字母、数字和短横线。",
			routeTaken: "已有提供方使用了这个 ID。",
			displayName: "显示名称",
			baseUrl: "API 地址",
			baseUrlPlaceholder: "http://localhost:11434",
			baseUrlHint: "Ollama 原生 API 地址，本地默认服务为 http://localhost:11434。",
			baseUrlRequired: "提供方需要填写 API 地址。",
			keepAlive: "保持时间（模型驻留时长）",
			temperature: "温度",
			temperatureInvalid: "温度必须是 0 到 2 之间的数字。",
			keyInput: "API 密钥",
			keyPlaceholder: "可选——Ollama 通常无需密钥",
			models: "模型目录",
			modelsEmpty: "还没有模型。可以从服务器获取，也可以手动添加。",
			fetchModels: "获取可用模型",
			fetching: "正在询问服务器…",
			fetchNeedsBaseUrl: "请先填写 API 地址，再获取。",
			fetchEmpty: "服务器没有列出任何模型，请手动添加。",
			fetchTitle: "选择要添加的模型",
			fetchDescription: "以下是模型提供方的可用模型，勾选要添加的模型。",
			fetchAdopt: "添加所选",
			cancel: "取消",
			close: "关闭",
			addModel: "添加模型",
			removeModel: "删除模型",
			modelId: "模型 ID",
			modelName: "显示名称",
			contextWindow: "上下文窗口",
			maxTokens: "最大输出 token",
			ollamaNumCtxHint: "Ollama 会将每个模型的上下文窗口作为 num_ctx 请求参数、最大输出 token 作为 num_predict 发送——这里填多少，API 就传多少。",
			modelInvalid: "每个模型需要唯一的 ID；容量需为正数，例如 4096、32K 或 1M。",
			save: "保存",
			saving: "保存中…",
			saved: "已保存。",
			delete: "删除",
			deleteConfirm: "删除该提供方？",
			deleting: "删除中…",
			notConfigured: "尚未配置——填写字段后保存。",
			configured: "已配置",
			custom: "自定义",
			conflict: "这张卡片打开期间，设置已被其他地方改动。请刷新后重试。",
			expandCapacities: "容量"
		};

		/** Scoped styles for this page (injected once, mirroring the product's css tag pattern). */
		const css = `
.dslollama_section{max-width:720px}
.dslollama_title{font-size:20px;font-weight:600;margin:0 0 8px;color:var(--dsw-alias-label-primary)}
.dslollama_intro{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;margin:0 0 16px}
.dslollama_notice{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:0 0 12px}
.dslollama_error{color:var(--dsw-alias-state-error-primary);font-size:13px;margin:4px 0 8px}
.dslollama_card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:16px;margin-bottom:14px;background:var(--dsw-alias-bg-layer-1)}
.dslollama_cardHead{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.dslollama_name{font-weight:600;font-size:14px;color:var(--dsw-alias-label-primary)}
.dslollama_route{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dslollama_tag{font-size:11px;padding:1px 6px;border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary)}
.dslollama_tagOk{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-success-primary)}
.dslollama_field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
.dslollama_fieldRow{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.dslollama_fieldRow .dslollama_field{margin-bottom:10px}
.dslollama_label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dslollama_input{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);padding:6px 8px;font-size:13px;width:100%;min-width:0;box-sizing:border-box}
.dslollama_input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.dslollama_hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:2px 0 8px}
.dslollama_models{border-top:1px solid var(--dsw-alias-border-l3);padding-top:10px;margin-top:4px}
.dslollama_modelsHead{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.dslollama_modelsTitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dslollama_modelRow{display:grid;grid-template-columns:1fr 1fr 28px 28px;gap:6px;align-items:center}
.dslollama_modelAdvanced{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 0 2px;margin-top:6px}
.dslollama_iconButton{border:0;background:transparent;color:var(--dsw-alias-label-secondary);width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;cursor:pointer;padding:0}
.dslollama_iconButton:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover)}
.dslollama_iconButtonDanger:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.dslollama_btn{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);padding:4px 10px;font-size:12px;cursor:pointer}
.dslollama_btn:disabled{opacity:.5;cursor:default}
.dslollama_btn:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover)}
.dslollama_btnPrimary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}
.dslollama_btnPrimary:not(:disabled):hover{background:var(--dsw-alias-button-primary-hover)}
.dslollama_btnDanger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-border-l2)}
.dslollama_btnDanger:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover-danger)}
.dslollama_fetchDialog{width:min(560px,100%)}
.dslollama_candidateList{list-style:none;margin:0;padding:0}
.dslollama_candidate{margin:0 0 6px}
.dslollama_candidateLabel{display:flex;gap:8px;align-items:center;font-size:13px;color:var(--dsw-alias-label-primary)}
.dslollama_candidateId{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;
		const tagId = "@zhangyi/dsh-llm-ollama/ollama.css";
		if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${tagId}"]`) === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@zhangyi/dsh-llm-ollama";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		/**
		* Model list editor: rows of id/name with expandable capacities, plus a
		* "fetch from the server" action that interrogates /api/tags through the
		* host plugin.
		*/
		function ModelListEditor(props) {
			const { api, t, baseURL, models, onChange, disabled } = props;
			const [busy, setBusy] = react.useState(false);
			const [failure, setFailure] = react.useState(void 0);
			const [candidates, setCandidates] = react.useState(void 0);
			const [picked, setPicked] = react.useState(new Set());
			const [expanded, setExpanded] = react.useState(new Set());

			const fetchModels = async () => {
				setBusy(true);
				setFailure(void 0);
				try {
					const response = await api.llm.discoverModels({
						settingsNs: NS,
						...(baseURL.trim().length > 0 ? { baseURL: baseURL.trim() } : {}),
						api: OLLAMA_API
					});
					if (!response.result.ok) {
						setFailure(response.result.error.message);
						return;
					}
					const found = response.result.value.models;
					if (found.length === 0) {
						setFailure(t("fetchEmpty"));
						return;
					}
					const known = new Set(models.map((model) => stringOf(model.id)));
					setCandidates(found);
					setPicked(new Set(found.filter((model) => !known.has(model.id)).map((model) => model.id)));
				} catch (error) {
					setFailure(messageOf(error));
				} finally {
					setBusy(false);
				}
			};
			const adoptPicked = () => {
				if (candidates === void 0) return;
				const byId = new Map(models.map((model) => [stringOf(model.id), model]));
				for (const candidate of candidates) {
					if (!picked.has(candidate.id)) continue;
					byId.set(candidate.id, byId.get(candidate.id) ?? { id: candidate.id, ...(candidate.name !== void 0 ? { name: candidate.name } : {}) });
				}
				onChange([...byId.values()]);
				setCandidates(void 0);
				setPicked(new Set());
			};
			const patch = (index, next) => {
				onChange(models.map((model, at) => {
					if (at !== index) return model;
					const cleared = new Set(Object.entries(next).filter(([, value]) => value === void 0 || value === "").map(([key]) => key));
					return Object.fromEntries(Object.entries({ ...model, ...next }).filter(([key]) => !cleared.has(key)));
				}));
			};
			const editCapacity = (index, field, text) => {
				const parsed = parseCapacity(text);
				if (parsed === void 0 || Number.isNaN(parsed)) {
					// blank clears; unreadable text simply does not commit (the
					// controlled input snaps back to the stored value)
					if (parsed === void 0) patch(index, { [field]: void 0 });
					return;
				}
				if (!Number.isInteger(parsed) || parsed <= 0) return;
				patch(index, { [field]: parsed });
			};
			const capacityText = (model, field) => {
				const value = model[field];
				return typeof value === "number" ? formatCapacity(value) : "";
			};
			const toggleExpanded = (index) => {
				setExpanded((current) => {
					const next = new Set(current);
					if (!next.delete(index)) next.add(index);
					return next;
				});
			};
			const togglePicked = (id) => {
				setPicked((current) => {
					const next = new Set(current);
					if (!next.delete(id)) next.add(id);
					return next;
				});
			};

			return react.createElement("div", { className: "dslollama_models" },
				react.createElement("div", { className: "dslollama_modelsHead" },
					react.createElement("span", { className: "dslollama_modelsTitle" }, t("models")),
					react.createElement("button", {
						className: "dslollama_btn",
						disabled: disabled || busy || baseURL.trim().length === 0,
						title: baseURL.trim().length === 0 ? t("fetchNeedsBaseUrl") : void 0,
						onClick: () => { fetchModels(); }
					}, busy ? t("fetching") : t("fetchModels"))
				),
				models.length === 0 ? react.createElement("p", { className: "dslollama_hint" }, t("modelsEmpty")) : null,
				models.map((model, index) => react.createElement("div", { key: index, className: "dslollama_card", style: { padding: 10, marginBottom: 8 } },
					react.createElement("div", { className: "dslollama_modelRow" },
						react.createElement("input", { className: "dslollama_input", type: "text", value: stringOf(model.id), placeholder: t("modelId"), disabled, onChange: (e) => patch(index, { id: e.target.value }) }),
						react.createElement("input", { className: "dslollama_input", type: "text", value: stringOf(model.name), placeholder: t("modelName"), disabled, onChange: (e) => patch(index, { name: e.target.value === "" ? void 0 : e.target.value }) }),
						react.createElement("button", { className: "dslollama_iconButton", type: "button", title: t("expandCapacities"), "aria-label": `${t("expandCapacities")} ${index + 1}`, "aria-expanded": expanded.has(index), disabled, onClick: () => toggleExpanded(index) },
							react.createElement(IconChevron, { open: expanded.has(index) })),
						react.createElement("button", { className: "dslollama_iconButton dslollama_iconButtonDanger", type: "button", title: t("removeModel"), "aria-label": `${t("removeModel")} ${index + 1}`, disabled, onClick: () => onChange(models.filter((_m, at) => at !== index)) },
							react.createElement(IconTrash, null))
					),
					expanded.has(index) ? react.createElement("div", { className: "dslollama_modelAdvanced" },
						react.createElement("div", { className: "dslollama_field" },
							react.createElement("span", { className: "dslollama_label" }, t("contextWindow")),
							react.createElement("input", { className: "dslollama_input", type: "text", inputMode: "numeric", value: capacityText(model, "contextWindow"), placeholder: "32K", disabled, onChange: (e) => editCapacity(index, "contextWindow", e.target.value) })),
						react.createElement("div", { className: "dslollama_field" },
							react.createElement("span", { className: "dslollama_label" }, t("maxTokens")),
							react.createElement("input", { className: "dslollama_input", type: "text", inputMode: "numeric", value: capacityText(model, "maxTokens"), placeholder: "32K", disabled, onChange: (e) => editCapacity(index, "maxTokens", e.target.value) })),
						react.createElement("p", { className: "dslollama_hint", style: { gridColumn: "1 / -1" } }, t("ollamaNumCtxHint"))
					) : null
				)),
				react.createElement("button", { className: "dslollama_btn", disabled, onClick: () => onChange([...models, { id: "" }]) }, t("addModel")),
				failure !== void 0 ? react.createElement("p", { className: "dslollama_error" }, failure) : null,
				react.createElement(_deepseek_ai_dsh_client_ui_primitives.Modal, {
					open: candidates !== void 0,
					onClose: () => { setCandidates(void 0); setPicked(new Set()); },
					title: t("fetchTitle"),
					closeLabel: t("close"),
					description: t("fetchDescription"),
					className: "dslollama_fetchDialog",
					footer: react.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
						react.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "outline", onClick: () => { setCandidates(void 0); setPicked(new Set()); } }, t("cancel")),
						react.createElement(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "outline", onClick: adoptPicked }, t("fetchAdopt")))
				}, react.createElement("ul", { className: "dslollama_candidateList" },
					(candidates ?? []).map((candidate) => react.createElement("li", { key: candidate.id, className: "dslollama_candidate" },
						react.createElement("label", { className: "dslollama_candidateLabel" },
							react.createElement("input", { type: "checkbox", checked: picked.has(candidate.id), onChange: () => togglePicked(candidate.id) }),
							react.createElement("span", { className: "dslollama_candidateId" }, candidate.id))))))
			);
		}

		/**
		* One provider card: edits one route's profile in the `llm-ollama`
		* namespace and writes it through the settings wire API.
		*/
		function ProviderCard(props) {
			const { api, t, route, profile, taken, writable, revision, onDone, onCancel } = props;
			const isConfigured = profile !== void 0;
			const isNew = route === void 0;
			const [routeDraft, setRouteDraft] = react.useState(isNew ? "" : route);
			const [displayName, setDisplayName] = react.useState(isConfigured ? stringOf(profile.displayName) : "");
			const [baseURL, setBaseURL] = react.useState(isConfigured ? stringOf(profile.baseURL) : "");
			const [keepAlive, setKeepAlive] = react.useState(isConfigured ? stringOf(profile.keepAlive) : "");
			const [temperature, setTemperature] = react.useState(isConfigured ? numberTextOf(profile.temperature) : "");
			const [keyDraft, setKeyDraft] = react.useState("");
			const [models, setModels] = react.useState(isConfigured ? (Array.isArray(profile.models) ? profile.models.map((model) => ({ ...model })) : []) : []);
			const [busy, setBusy] = react.useState(false);
			const [failure, setFailure] = react.useState(void 0);
			const [saved, setSaved] = react.useState(false);
			const [confirmDelete, setConfirmDelete] = react.useState(false);
			const [deleting, setDeleting] = react.useState(false);

			const routeInvalid = routeDraft.length > 0 && !ROUTE_PATTERN.test(routeDraft);
			const routeTaken = isNew && taken.includes(routeDraft);
			const effectiveRoute = isNew ? routeDraft : route;
			const temperatureNumber = Number.parseFloat(temperature);
			const temperatureValid = temperature.trim().length === 0 || Number.isFinite(temperatureNumber) && temperatureNumber >= 0 && temperatureNumber <= 2;
			const modelError = (() => {
				const seen = new Set();
				for (const model of models) {
					const id = stringOf(model.id).trim();
					if (id.length === 0) return t("modelInvalid");
					if (seen.has(id)) return t("modelInvalid");
					seen.add(id);
					for (const field of ["contextWindow", "maxTokens"]) {
						const value = model[field];
						if (value !== void 0 && (typeof value !== "number" || !Number.isInteger(value) || value <= 0)) return t("modelInvalid");
					}
				}
				return void 0;
			})();
			const ready = effectiveRoute !== void 0 && effectiveRoute.length > 0 && !routeInvalid && !routeTaken && baseURL.trim().length > 0 && modelError === void 0 && temperatureValid;

			const save = async () => {
				setBusy(true);
				setFailure(void 0);
				setSaved(false);
				try {
					const storesKey = keyDraft.trim().length > 0;
					const keyRef = deriveKeyRef(effectiveRoute);
					const profileValue = {
						...(displayName.trim().length > 0 ? { displayName: displayName.trim() } : {}),
						api: OLLAMA_API,
						baseURL: baseURL.trim(),
						...(storesKey ? { apiKeyEnv: keyRef } : {}),
						models: models.map((model) => {
							const next = { id: stringOf(model.id).trim() };
							if (stringOf(model.name).trim().length > 0) next.name = model.name.trim();
							if (model.contextWindow !== void 0) next.contextWindow = model.contextWindow;
							if (model.maxTokens !== void 0) next.maxTokens = model.maxTokens;
							return next;
						}),
						...(keepAlive.trim().length > 0 ? { keepAlive: keepAlive.trim() } : {}),
						...(temperature.trim().length > 0 ? { temperature: temperatureNumber } : {})
					};
					const response = await api.settings.mutate({
						ns: NS,
						ops: [{ op: "set", path: ["providers", effectiveRoute], value: profileValue }],
						expectedRevision: revision
					});
					if (!response.result.ok) {
						setFailure(response.result.error.code === "settings-conflict" ? t("conflict") : response.result.error.message);
						return;
					}
					if (storesKey) {
						const stored = await api.credentials.set({ ref: keyRef, value: keyDraft.trim() });
						if (!stored.result.ok) {
							setFailure(stored.result.error.message);
							return;
						}
					}
					setSaved(true);
					onDone();
				} catch (error) {
					setFailure(messageOf(error));
				} finally {
					setBusy(false);
				}
			};
			const remove = async () => {
				setDeleting(true);
				setFailure(void 0);
				try {
					if (isConfigured && typeof profile.apiKeyEnv === "string" && profile.apiKeyEnv.length > 0) {
						const credential = await api.credentials.unset({ ref: profile.apiKeyEnv });
						if (!credential.result.ok) {
							setFailure(credential.result.error.message);
							return;
						}
					}
					const response = await api.settings.mutate({
						ns: NS,
						ops: [{ op: "unset", path: ["providers", effectiveRoute] }],
						expectedRevision: revision
					});
					if (!response.result.ok) {
						setFailure(response.result.error.code === "settings-conflict" ? t("conflict") : response.result.error.message);
						return;
					}
					onDone();
				} catch (error) {
					setFailure(messageOf(error));
				} finally {
					setDeleting(false);
				}
			};

			const field = (label, children) => react.createElement("div", { className: "dslollama_field" },
				react.createElement("span", { className: "dslollama_label" }, label),
				children
			);
			const textInput = (value, onChange, placeholder, extra) => react.createElement("input", Object.assign({
				className: "dslollama_input",
				type: "text",
				value,
				placeholder,
				disabled: busy || !writable,
				onChange
			}, extra || {}));

			return react.createElement("div", { className: "dslollama_card" },
				react.createElement("div", { className: "dslollama_cardHead" },
					react.createElement("span", { className: "dslollama_name" }, displayName.trim().length > 0 ? displayName : (isNew ? t("add") : effectiveRoute)),
					react.createElement("span", { className: "dslollama_route" }, effectiveRoute),
					isConfigured
						? react.createElement("span", { className: "dslollama_tag dslollama_tagOk" }, t("configured"))
						: react.createElement("span", { className: "dslollama_tag" }, t("custom"))
				),
				isNew ? field(t("route"), react.createElement("div", null,
					textInput(routeDraft, (e) => setRouteDraft(e.target.value), "my-ollama"),
					routeInvalid ? react.createElement("p", { className: "dslollama_error" }, t("routeInvalid"))
						: routeTaken ? react.createElement("p", { className: "dslollama_error" }, t("routeTaken"))
						: react.createElement("p", { className: "dslollama_hint" }, t("routeHint"))
				)) : null,
				field(t("displayName"), textInput(displayName, (e) => setDisplayName(e.target.value), effectiveRoute)),
				field(t("baseUrl"), react.createElement("div", null,
					textInput(baseURL, (e) => setBaseURL(e.target.value), t("baseUrlPlaceholder")),
					react.createElement("p", { className: "dslollama_hint" }, t("baseUrlHint"))
				)),
				react.createElement("div", { className: "dslollama_fieldRow" },
					field(t("keepAlive"), textInput(keepAlive, (e) => setKeepAlive(e.target.value), "5m")),
					field(t("temperature"), react.createElement("div", null,
						textInput(temperature, (e) => setTemperature(e.target.value), "0.8", { inputMode: "decimal" }),
						temperature.trim().length > 0 && !temperatureValid ? react.createElement("p", { className: "dslollama_error" }, t("temperatureInvalid")) : null
					))
				),
				field(t("keyInput"), textInput(keyDraft, (e) => setKeyDraft(e.target.value), t("keyPlaceholder"), { type: "password", autoComplete: "off" })),
				react.createElement(ModelListEditor, { api, t, baseURL, models, onChange: setModels, disabled: busy || !writable }),
				!isConfigured ? react.createElement("p", { className: "dslollama_hint" }, t("notConfigured")) : null,
				modelError !== void 0 ? react.createElement("p", { className: "dslollama_error" }, modelError) : null,
				failure !== void 0 ? react.createElement("p", { className: "dslollama_error" }, failure) : null,
				saved ? react.createElement("p", { className: "dslollama_hint", role: "status" }, t("saved")) : null,
				react.createElement("div", { style: { display: "flex", gap: 8, marginTop: 4 } },
					react.createElement("button", { className: "dslollama_btn dslollama_btnPrimary", disabled: busy || deleting || !writable || !ready, onClick: () => { save(); } },
						busy ? t("saving") : t("save")),
					isConfigured ? (confirmDelete
						? react.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
							react.createElement("span", { className: "dslollama_label" }, t("deleteConfirm")),
							react.createElement("button", { className: "dslollama_btn dslollama_btnDanger", disabled: busy || deleting || !writable, onClick: () => { remove(); } }, deleting ? t("deleting") : t("delete")),
							react.createElement("button", { className: "dslollama_btn", disabled: busy || deleting, onClick: () => setConfirmDelete(false) }, t("cancel")))
						: react.createElement("button", { className: "dslollama_btn dslollama_btnDanger", disabled: busy || !writable, onClick: () => setConfirmDelete(true) }, t("delete")))
					: isNew ? react.createElement("button", { className: "dslollama_btn", disabled: busy || !writable, onClick: onCancel }, t("cancel")) : null
				)
			);
		}

		/**
		* The whole-page Ollama settings section. Joins the `llm-ollama`
		* namespace view (profiles) with the configurable-provider directory,
		* then renders one card per provider (the dormant `ollama` route appears
		* as an unconfigured card) plus an "add provider" action.
		*/
		function OllamaSection(props) {
			const { api, t, subscribe } = props;
			const [snapshot, setSnapshot] = react.useState({ status: "loading", error: null, writable: false, revision: 0, rows: [] });
			const [adding, setAdding] = react.useState(false);
			const loadRef = react.useRef(null);

			const load = () => {
				setSnapshot((current) => ({ ...current, status: "loading", error: null }));
				Promise.all([api.settings.describe({}), api.llm.providers({})]).then(([settingsRes, providersRes]) => {
					if (!settingsRes.result.ok) throw new Error(settingsRes.result.error.message);
					if (!providersRes.result.ok) throw new Error(providersRes.result.error.message);
					const ns = settingsRes.result.value.namespaces.find((candidate) => candidate.ns === "llm-ollama");
					const value = ns?.value ?? { providers: {} };
					const profiles = new Map(Object.entries(value.providers ?? {}).map(([route, profile]) => [route, profile]));
					const directory = providersRes.result.value.providers.filter((entry) => entry.settingsNs === "llm-ollama");
					// Every directory route, plus any configured profile route not in the directory.
					const routes = new Set(directory.map((entry) => entry.provider));
					for (const route of profiles.keys()) routes.add(route);
					const rows = [...routes].map((route) => ({ route, profile: profiles.get(route) }));
					setSnapshot({ status: "ready", error: null, writable: settingsRes.result.value.writable, revision: ns?.revision ?? 0, rows });
				}, (error) => {
					setSnapshot((current) => ({ ...current, status: "error", error: messageOf(error) }));
				});
			};
			loadRef.current = load;

			react.useEffect(() => {
				loadRef.current();
				return subscribe !== void 0 ? subscribe(() => loadRef.current()) : void 0;
			}, []);

			if (snapshot.status === "loading") {
				return react.createElement("div", { className: "dslollama_section" }, react.createElement("p", { className: "dslollama_hint" }, "…"));
			}
			if (snapshot.status === "error") {
				return react.createElement("div", { className: "dslollama_section" },
					react.createElement("p", { className: "dslollama_error" }, `${t("loadFailed")}: ${snapshot.error}`),
					react.createElement("button", { className: "dslollama_btn", onClick: load }, t("retry"))
				);
			}
			const taken = snapshot.rows.map((row) => row.route);
			return react.createElement("div", { className: "dslollama_section" },
				react.createElement("h2", { className: "dslollama_title" }, t("title")),
				react.createElement("p", { className: "dslollama_intro" }, t("intro")),
				!snapshot.writable ? react.createElement("p", { className: "dslollama_notice" }, t("readOnly")) : null,
				snapshot.rows.map((row) => react.createElement(ProviderCard, {
					key: row.route,
					api,
					t,
					route: row.route,
					profile: row.profile,
					taken,
					writable: snapshot.writable,
					revision: snapshot.revision,
					onDone: load
				})),
				adding ? react.createElement(ProviderCard, {
					api,
					t,
					route: void 0,
					profile: void 0,
					taken,
					writable: snapshot.writable,
					revision: snapshot.revision,
					onDone: () => { setAdding(false); load(); },
					onCancel: () => setAdding(false)
				}) : react.createElement("button", { className: "dslollama_btn", disabled: !snapshot.writable, onClick: () => setAdding(true) },
					react.createElement(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, { size: 14 }), " ", t("add"))
			);
		}

		const inject = ["slots", "locale", "connection", "remote"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-llm-ollama: copy dictionaries");
			const t = ctx.locale.bind(NS);
			const refreshListeners = new Set();
			const subscribe = (listener) => {
				refreshListeners.add(listener);
				return () => refreshListeners.delete(listener);
			};
			const injected = () => ({ api: ctx.get("connection").api, t, subscribe });
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "ollama",
				order: 11,
				label: () => t("nav"),
				inject: injected
			}, OllamaSection));
			ctx.effect(() => {
				const notify = () => {
					for (const listener of [...refreshListeners]) {
						try {
							listener();
						} catch (error) {
							console.error("dsh-llm-ollama: refresh listener failed", error);
						}
					}
				};
				const disposers = [
					ctx.remote.$on("settings/document-updated", notify),
					ctx.remote.$on("llm/adapters-updated", notify),
					ctx.on("connection/reset", notify)
				];
				return () => {
					for (const dispose of disposers) dispose();
				};
			}, "dsh-llm-ollama: invalidations");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
