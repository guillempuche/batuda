import type { LangCode } from '#/i18n'

export interface ServiceExample {
	industry: string
	problem: string
	solution: string
	result: string
}

export interface Service {
	slug: string
	name: Record<LangCode, string>
	tagline: Record<LangCode, string>
	description: Record<LangCode, string>
	inputs: Record<LangCode, string[]>
	outputs: Record<LangCode, string[]>
	examples: Record<LangCode, ServiceExample[]>
	/** Optional — during pilot discovery, pricing is not published. */
	startingPrice?: string
	/** Optional — paired with `startingPrice`. */
	priceUnit?: Record<LangCode, string>
	includes: Record<LangCode, string[]>
	/** Optional annual support contract, additional fee on top of the base engagement. */
	ongoingSupport?: Record<LangCode, string>
	excludes: Record<LangCode, string[]>
}

export const services: Service[] = [
	{
		slug: 'automatitzacions',
		name: {
			ca: 'Automatització',
			es: 'Automatización',
			en: 'Automation',
		},
		tagline: {
			ca: 'Connectem les eines que ja fas servir perquè les tasques setmanals i mensuals es facin soles.',
			es: 'Conectamos las herramientas que ya usas para que las tareas semanales y mensuales se hagan solas.',
			en: 'Flow glue between the tools you already use, so the weekly and monthly manual tasks move on their own.',
		},
		description: {
			ca: "Connectem les eines que el teu equip ja fa servir — correu, facturació i comptabilitat, fulls de càlcul, CRM, ERP, discs al núvol, formularis web, WhatsApp, safates compartides. La informació es mou sola entre departaments: res oblidat, res retranscrit. Cap eina nova per aprendre, cap nou lloc on fer login. La setmana de l'equip es torna més tranquil·la.",
			es: 'Conectamos las herramientas que tu equipo ya usa — email, facturación y contabilidad, hojas de cálculo, CRM, ERP, discos en la nube, formularios web, WhatsApp, bandejas compartidas. La información se mueve sola entre departamentos: nada olvidado, nada retranscrito. Ninguna herramienta nueva que aprender, ningún nuevo sitio donde loguearse. La semana del equipo se vuelve más tranquila.',
			en: "Flow glue between the tools your team already uses — email, invoicing and accounting systems, spreadsheets, CRM, ERP, cloud drives, web forms, WhatsApp, shared inboxes, ticketing tools. Information moves on its own across departments; nothing forgotten, nothing re-typed. No new tools for the team to learn, no new places to log in. The team's week gets quieter.",
		},
		inputs: {
			ca: [
				'Factures',
				'Correus',
				'Formularis web',
				'Fulls de càlcul',
				'Tiquets de TPV',
				'Missatges de WhatsApp',
				'Safates compartides',
				'Recomptes en paper',
			],
			es: [
				'Facturas',
				'Correos',
				'Formularios web',
				'Hojas de cálculo',
				'Tiques de TPV',
				'Mensajes de WhatsApp',
				'Bandejas compartidas',
				'Conteos en papel',
			],
			en: [
				'Invoices',
				'Emails',
				'Web forms',
				'Spreadsheets',
				'POS tickets',
				'WhatsApp messages',
				'Shared inboxes',
				'Paper-based counts',
			],
		},
		outputs: {
			ca: [
				'Registres actualitzats sols',
				'Notificacions automàtiques',
				'Informes generats',
				'Correus classificats i enrutats',
				"Dades extretes d'una eina i dipositades a una altra",
			],
			es: [
				'Registros actualizados solos',
				'Notificaciones automáticas',
				'Informes generados',
				'Correos clasificados y enrutados',
				'Datos extraídos de una herramienta y depositados en otra',
			],
			en: [
				'Updated records',
				'Automatic notifications',
				'Generated reports',
				'Classified and routed emails',
				'Data extracted from one tool and dropped into another',
			],
		},
		examples: {
			ca: [
				{
					industry: 'Fabricació metal·lúrgica (~60 persones)',
					problem:
						'Les comandes de feina arribaven com a fotos de WhatsApp i PDFs per correu en diverses safates. Dos treballs es van perdre el trimestre passat.',
					solution:
						'Captació automàtica des del correu i WhatsApp al planificador, amb notificacions instantànies als caps de torn.',
					result: '~6 h/setmana alliberades, zero feines perdudes',
				},
				{
					industry:
						"Estudi d'arquitectura (~40 persones, ~90 projectes actius)",
					problem:
						"La documentació de projectes de clients, proveïdors i l'ajuntament arribava a una safata compartida i s'arxivava a mà per codi de projecte.",
					solution:
						'Flux que llegeix el correu, detecta el codi del projecte, arxiva els adjunts a la carpeta correcta i avisa el responsable.',
					result: '~8 h/setmana alliberades, arxiu sempre complet',
				},
				{
					industry:
						'Grup de tallers mecànics (~4 seus, equip financer compartit)',
					problem:
						'Les factures de proveïdors i albarans es transcrivien al programa comptable cada divendres a la tarda.',
					solution:
						'Extracció automàtica dels PDFs dels proveïdors al programa comptable, una canonada per proveïdor.',
					result:
						'Divendres a la tarda recuperats per a les 3 persones de finances',
				},
			],
			es: [
				{
					industry: 'Fabricación metalúrgica (~60 personas)',
					problem:
						'Los pedidos de trabajo llegaban como fotos de WhatsApp y PDFs por correo en varias bandejas. Dos trabajos se perdieron el trimestre pasado.',
					solution:
						'Captación automática desde el correo y WhatsApp al planificador, con notificaciones instantáneas a los jefes de turno.',
					result: '~6 h/semana liberadas, cero trabajos perdidos',
				},
				{
					industry:
						'Estudio de arquitectura (~40 personas, ~90 proyectos activos)',
					problem:
						'La documentación de proyectos de clientes, proveedores y el ayuntamiento llegaba a una bandeja compartida y se archivaba a mano por código de proyecto.',
					solution:
						'Flujo que lee el correo, detecta el código del proyecto, archiva los adjuntos en la carpeta correcta y avisa al responsable.',
					result: '~8 h/semana liberadas, archivo siempre completo',
				},
				{
					industry:
						'Grupo de talleres mecánicos (~4 sedes, equipo financiero compartido)',
					problem:
						'Las facturas de proveedores y albaranes se transcribían al programa contable cada viernes por la tarde.',
					solution:
						'Extracción automática de los PDFs de los proveedores al programa contable, un pipeline por proveedor.',
					result:
						'Viernes por la tarde recuperados para las 3 personas de finanzas',
				},
			],
			en: [
				{
					industry: 'Metalworking fabricator (~60 employees)',
					problem:
						'Job orders arrived as WhatsApp photos and emailed PDFs across multiple inboxes. Two jobs fell through the cracks last quarter.',
					solution:
						'Automatic intake from email and WhatsApp into the planner, with instant notifications to shift leads.',
					result: '~6 h/week freed across the ops team, zero lost jobs',
				},
				{
					industry: 'Architecture studio (~40 people, ~90 active projects)',
					problem:
						'Project documents from clients, suppliers, and the municipality landed in a shared mailbox and were filed by hand into shared-drive folders by project code.',
					solution:
						'A flow reads incoming email, detects the project code, files the attachments into the right folder, and notifies the project lead.',
					result: '~8 h/week freed, filing always complete',
				},
				{
					industry:
						'Automotive workshop group (~4 locations, shared finance team)',
					problem:
						'Supplier invoices and delivery notes were typed into the accounting system every Friday afternoon.',
					solution:
						'Automatic extraction from supplier PDFs into the accounting system, one pipeline per supplier.',
					result: 'Friday afternoons back across the 3-person finance team',
				},
			],
		},
		includes: {
			ca: [
				'Reunió de descobriment',
				'Disseny del flux',
				'Integració amb les eines existents del client',
				'Test i posada en marxa',
				'Suport 30 dies post-llançament',
			],
			es: [
				'Reunión de descubrimiento',
				'Diseño del flujo',
				'Integración con las herramientas existentes del cliente',
				'Test y puesta en marcha',
				'Soporte 30 días post-lanzamiento',
			],
			en: [
				'Discovery meeting',
				'Flow design',
				"Integration with the customer's existing tools",
				'Testing and launch',
				'30-day support after go-live',
			],
		},
		ongoingSupport: {
			ca: "Contracte anual de suport opcional (tarifa addicional): monitoratge, ajustos menors, rotació de credencials, correcció d'errors i actualitzacions del manual. Horari laboral (dilluns–divendres, 9:00–18:00 CET). Preu per encàrrec.",
			es: 'Contrato anual de soporte opcional (tarifa adicional): monitoreo, ajustes menores, rotación de credenciales, corrección de errores y actualizaciones del manual. Horario laboral (lunes–viernes, 9:00–18:00 CET). Precio por encargo.',
			en: 'Optional annual support contract (additional fee): monitoring, minor adjustments, credential rotation, break-fix, and runbook updates. Business hours (Mon–Fri, 9:00–18:00 CET). Priced per engagement.',
		},
		excludes: {
			ca: [
				'Subscripcions a tercers (Zapier, Make i equivalents)',
				'Migració de dades antigues',
				'Integracions no planificades',
				"Canvis d'abast post-lliurament",
			],
			es: [
				'Suscripciones a terceros (Zapier, Make y equivalentes)',
				'Migración de datos antiguas',
				'Integraciones no planificadas',
				'Cambios de alcance post-entrega',
			],
			en: [
				'Third-party subscriptions (Zapier, Make, and equivalents)',
				'Migration of legacy data',
				'Unplanned integrations',
				'Scope changes after delivery',
			],
		},
	},
	{
		slug: 'agents-ia',
		name: {
			ca: 'Agents IA',
			es: 'Agentes IA',
			en: 'AI agents',
		},
		tagline: {
			ca: "Assistents d'IA a mida que llegeixen, classifiquen, responen o resumeixen — perquè l'equip es centri en les decisions, no en la triatge.",
			es: 'Asistentes de IA a medida que leen, clasifican, responden o resumen — para que el equipo se centre en las decisiones, no en el triaje.',
			en: 'Custom AI assistants that read, classify, answer, or summarise — so your team focuses on the decisions, not the triage.',
		},
		description: {
			ca: "Agents d'IA a mida que llegeixen, classifiquen, responen o resumeixen entrada no estructurada al volum on un equip humà comença a ofegar-se — desenes a centenars de correus, missatges o documents al dia. L'agent treballa de manera autònoma en la seva part de la feina; l'equip del client es queda amb la decisió final en qualsevol cosa que importi. Mai per a generació de contingut creatiu. Mai per a decisions amb responsabilitat legal o financera on cal una signatura humana.",
			es: 'Agentes de IA a medida que leen, clasifican, responden o resumen entrada no estructurada al volumen donde un equipo humano empieza a ahogarse — decenas a centenares de correos, mensajes o documentos al día. El agente trabaja de forma autónoma en su parte del trabajo; el equipo del cliente se queda con la decisión final en cualquier cosa que importe. Nunca para generación de contenido creativo. Nunca para decisiones con responsabilidad legal o financiera donde se requiera una firma humana.',
			en: "Custom AI agents that read, classify, answer, or summarise unstructured input at the volume where a human team starts to drown — dozens to hundreds of emails, messages, or documents per day. The agent works autonomously on its portion of the task; the customer's team keeps the final decision on anything that matters. Never used for creative content generation. Never used for decisions with legal or financial liability where a human signature is required.",
		},
		inputs: {
			ca: [
				'Correus',
				'Documents PDF',
				'Consultes de clients',
				'Enregistraments de reunions',
				'Missatges de WhatsApp',
				'Safates compartides',
				'Preguntes recurrents de clients',
			],
			es: [
				'Correos',
				'Documentos PDF',
				'Consultas de clientes',
				'Grabaciones de reuniones',
				'Mensajes de WhatsApp',
				'Bandejas compartidas',
				'Preguntas recurrentes de clientes',
			],
			en: [
				'Emails',
				'PDF documents',
				'Customer queries',
				'Meeting recordings',
				'WhatsApp messages',
				'Shared inboxes',
				'Recurring customer questions',
			],
		},
		outputs: {
			ca: [
				'Correus classificats',
				'Dades estructurades extretes',
				'Respostes automàtiques',
				'Resums de reunions',
				'Tasques enrutades',
				'Esborranys de resposta per validació humana',
			],
			es: [
				'Correos clasificados',
				'Datos estructurados extraídos',
				'Respuestas automáticas',
				'Resúmenes de reuniones',
				'Tareas enrutadas',
				'Borradores de respuesta para validación humana',
			],
			en: [
				'Classified emails',
				'Extracted structured data',
				'Automatic responses',
				'Meeting summaries',
				'Routed tasks',
				'Agent-drafted replies for human approval',
			],
		},
		examples: {
			ca: [
				{
					industry:
						"Consultoria d'enginyeria (~50 persones, multidisciplinària)",
					problem:
						"Les sol·licituds de pressupost arribaven com a correus de text lliure amb especificacions adjuntes. L'equip d'operacions passava ~90 min cada matí classificant-les per disciplina.",
					solution:
						"Un agent d'IA llegeix cada RFQ, extreu les especificacions clau, classifica la disciplina i suggereix una ruta que el soci aprova.",
					result: '~1,5 h/dia alliberades, primera resposta més ràpida',
				},
				{
					industry: 'Administració de finques (~800 unitats sota gestió)',
					problem:
						'Les preguntes de llogaters per WhatsApp — lloguer, inspeccions, petites reparacions — interrompien el front office durant tot el dia.',
					solution:
						"Un agent d'IA respon preguntes rutinàries des del manual de llogaters i escala la resta al front office amb un esborrany de resposta.",
					result: '~3 h/dia alliberades, resposta més ràpida als llogaters',
				},
			],
			es: [
				{
					industry:
						'Consultoría de ingeniería (~50 personas, multidisciplinaria)',
					problem:
						'Las solicitudes de presupuesto llegaban como correos de texto libre con especificaciones adjuntas. El equipo de operaciones pasaba ~90 min cada mañana clasificándolas por disciplina.',
					solution:
						'Un agente de IA lee cada RFQ, extrae las especificaciones clave, clasifica la disciplina y sugiere un enrutamiento que el socio aprueba.',
					result: '~1,5 h/día liberadas, primera respuesta más rápida',
				},
				{
					industry: 'Administración de fincas (~800 unidades bajo gestión)',
					problem:
						'Las preguntas de inquilinos por WhatsApp — alquiler, inspecciones, pequeñas reparaciones — interrumpían el front office durante todo el día.',
					solution:
						'Un agente de IA responde preguntas rutinarias desde el manual de inquilinos y escala el resto al front office con un borrador de respuesta.',
					result: '~3 h/día liberadas, respuesta más rápida a los inquilinos',
				},
			],
			en: [
				{
					industry: 'Engineering consultancy (~50 people, multi-discipline)',
					problem:
						'RFQs arrived as free-text emails with attached specs. The ops team spent ~90 min every morning classifying them by discipline.',
					solution:
						'An AI agent reads each RFQ, extracts the key specs, classifies the discipline, and drafts a routing suggestion the partner approves.',
					result: '~1.5 h/day freed, faster first response to clients',
				},
				{
					industry: 'Property management firm (~800 units under management)',
					problem:
						'Tenant questions on WhatsApp — rent, inspections, small repairs — were handled one by one by the front office, interrupting the rest of the day.',
					solution:
						'An AI agent answers routine questions from the tenant handbook and escalates the rest to the front office with a drafted reply.',
					result:
						'~3 h/day freed across the front office, faster tenant responses',
				},
			],
		},
		includes: {
			ca: [
				'Reunió de descobriment',
				"Disseny de l'agent (rol, límits, regles de respall, punts de control humà)",
				'Configuració del model',
				'Ajustament inicial',
				'Test i posada en marxa',
				'Suport 30 dies post-llançament',
			],
			es: [
				'Reunión de descubrimiento',
				'Diseño del agente (rol, límites, reglas de respaldo, puntos de control humano)',
				'Configuración del modelo',
				'Ajuste inicial',
				'Test y puesta en marcha',
				'Soporte 30 días post-lanzamiento',
			],
			en: [
				'Discovery meeting',
				'Agent design (role, boundaries, fallback rules, human-in-the-loop checkpoints)',
				'Model configuration',
				'Initial tuning',
				'Testing and launch',
				'30-day support after go-live',
			],
		},
		ongoingSupport: {
			ca: "Contracte anual de suport opcional (tarifa addicional): monitoratge d'avaluacions, ajustos de prompts, actualitzacions de configuració del model, comprovacions de regressió i correcció d'errors. Horari laboral (dilluns–divendres, 9:00–18:00 CET). Preu per encàrrec.",
			es: 'Contrato anual de soporte opcional (tarifa adicional): monitoreo de evaluaciones, ajustes de prompts, actualizaciones de configuración del modelo, comprobaciones de regresión y corrección de errores. Horario laboral (lunes–viernes, 9:00–18:00 CET). Precio por encargo.',
			en: 'Optional annual support contract (additional fee): eval monitoring, prompt adjustments, model configuration updates, regression checks, and break-fix. Business hours (Mon–Fri, 9:00–18:00 CET). Priced per engagement.',
		},
		excludes: {
			ca: [
				"Costos d'API d'IA (OpenAI i equivalents)",
				'Generació de contingut creatiu',
				'Decisions amb responsabilitat legal o financera',
				"Canvis d'abast post-lliurament",
			],
			es: [
				'Costes de API de IA (OpenAI y equivalentes)',
				'Generación de contenido creativo',
				'Decisiones con responsabilidad legal o financiera',
				'Cambios de alcance post-entrega',
			],
			en: [
				'AI API costs (OpenAI and equivalents)',
				'Creative content generation',
				'Decisions with legal or financial liability',
				'Scope changes after delivery',
			],
		},
	},
]

export function getServiceBySlug(slug: string): Service | undefined {
	return services.find(s => s.slug === slug)
}
