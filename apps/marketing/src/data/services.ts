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
	startingPrice: string
	priceUnit: Record<LangCode, string>
	includes: Record<LangCode, string[]>
	excludes: Record<LangCode, string[]>
}

export const services: Service[] = [
	{
		slug: 'automatitzacions',
		name: {
			ca: 'Automatitzacions',
			es: 'Automatizaciones',
			en: 'Automations',
		},
		tagline: {
			ca: 'Connectem les teves eines perquè quan passi X, passi Y.',
			es: 'Conectamos tus herramientas para que cuando pase X, pase Y.',
			en: 'We connect your tools so when X happens, Y happens.',
		},
		description: {
			ca: 'Integrem els sistemes que ja fas servir — facturació, correu, fulls de càlcul, CRM — perquè la informació flueixi sola. Sense copiar i enganxar, sense oblidar-se de res.',
			es: 'Integramos los sistemas que ya usas — facturación, correo, hojas de cálculo, CRM — para que la información fluya sola. Sin copiar y pegar, sin olvidarse de nada.',
			en: 'We integrate the systems you already use — invoicing, email, spreadsheets, CRM — so information flows on its own. No copy-paste, nothing forgotten.',
		},
		inputs: {
			ca: ['Factures', 'Correus', 'Formularis web', 'Fulls de càlcul'],
			es: ['Facturas', 'Correos', 'Formularios web', 'Hojas de cálculo'],
			en: ['Invoices', 'Emails', 'Web forms', 'Spreadsheets'],
		},
		outputs: {
			ca: [
				'Registres actualitzats',
				'Notificacions automàtiques',
				'Informes generats',
				'Tasques assignades',
			],
			es: [
				'Registros actualizados',
				'Notificaciones automáticas',
				'Informes generados',
				'Tareas asignadas',
			],
			en: [
				'Updated records',
				'Automatic notifications',
				'Generated reports',
				'Assigned tasks',
			],
		},
		examples: {
			ca: [
				{
					industry: 'Restauració',
					problem:
						'El comptable copiava factures del TPV al programa de comptabilitat cada setmana.',
					solution:
						'Connexió automàtica entre el TPV i el programa de facturació.',
					result: '8h/setmana estalviades',
				},
				{
					industry: 'Comerç',
					problem:
						'Les comandes online es gestionaven manualment per WhatsApp.',
					solution:
						"Formulari web connectat a la gestió d'estoc i avisos automàtics.",
					result: 'Zero comandes perdudes',
				},
			],
			es: [
				{
					industry: 'Restauración',
					problem:
						'El contable copiaba facturas del TPV al programa de contabilidad cada semana.',
					solution:
						'Conexión automática entre el TPV y el programa de facturación.',
					result: '8h/semana ahorradas',
				},
				{
					industry: 'Comercio',
					problem:
						'Los pedidos online se gestionaban manualmente por WhatsApp.',
					solution:
						'Formulario web conectado a la gestión de stock y avisos automáticos.',
					result: 'Cero pedidos perdidos',
				},
			],
			en: [
				{
					industry: 'Restaurants',
					problem:
						'The accountant was copying invoices from the POS to accounting software weekly.',
					solution: 'Automatic connection between POS and invoicing software.',
					result: '8h/week saved',
				},
				{
					industry: 'Retail',
					problem: 'Online orders were managed manually via WhatsApp.',
					solution:
						'Web form connected to stock management with automatic alerts.',
					result: 'Zero lost orders',
				},
			],
		},
		startingPrice: '500 €',
		priceUnit: {
			ca: 'per automatització',
			es: 'por automatización',
			en: 'per automation',
		},
		includes: {
			ca: [
				'Disseny del flux',
				'Implementació',
				'Test i posada en marxa',
				'Suport 30 dies',
			],
			es: [
				'Diseño del flujo',
				'Implementación',
				'Test y puesta en marcha',
				'Soporte 30 días',
			],
			en: [
				'Flow design',
				'Implementation',
				'Testing & launch',
				'30-day support',
			],
		},
		excludes: {
			ca: [
				'Subscripcions a tercers (Zapier, Make...)',
				"Canvis d'abast post-lliurament",
			],
			es: [
				'Suscripciones a terceros (Zapier, Make...)',
				'Cambios de alcance post-entrega',
			],
			en: [
				'Third-party subscriptions (Zapier, Make...)',
				'Scope changes after delivery',
			],
		},
	},
	{
		slug: 'intel-ligencia-artificial',
		name: {
			ca: 'Intel·ligència artificial',
			es: 'Inteligencia artificial',
			en: 'Artificial intelligence',
		},
		tagline: {
			ca: 'La IA fa el judici, tu prens les decisions.',
			es: 'La IA hace el juicio, tú tomas las decisiones.',
			en: 'AI handles judgement, you make the decisions.',
		},
		description: {
			ca: "Apliquem models d'IA a tasques que requereixen judici però no creativitat: classificar correus, extreure dades de documents, respondre preguntes freqüents, resumir reunions.",
			es: 'Aplicamos modelos de IA a tareas que requieren juicio pero no creatividad: clasificar correos, extraer datos de documentos, responder preguntas frecuentes, resumir reuniones.',
			en: 'We apply AI models to tasks that require judgement but not creativity: classifying emails, extracting data from documents, answering FAQs, summarising meetings.',
		},
		inputs: {
			ca: [
				'Correus',
				'Documents PDF',
				'Àudios de reunions',
				'Consultes de clients',
			],
			es: [
				'Correos',
				'Documentos PDF',
				'Audios de reuniones',
				'Consultas de clientes',
			],
			en: ['Emails', 'PDF documents', 'Meeting recordings', 'Client queries'],
		},
		outputs: {
			ca: [
				'Correus classificats',
				'Dades extretes',
				'Respostes automàtiques',
				'Resums de reunions',
			],
			es: [
				'Correos clasificados',
				'Datos extraídos',
				'Respuestas automáticas',
				'Resúmenes de reuniones',
			],
			en: [
				'Classified emails',
				'Extracted data',
				'Automatic responses',
				'Meeting summaries',
			],
		},
		examples: {
			ca: [
				{
					industry: 'Assessoria',
					problem:
						'Cada matí, 30 min classificant correus i reenviant-los al departament correcte.',
					solution:
						'IA que llegeix el correu, el classifica i el reenvia automàticament.',
					result: '30 min/dia estalviats',
				},
			],
			es: [
				{
					industry: 'Asesoría',
					problem:
						'Cada mañana, 30 min clasificando correos y reenviándolos al departamento correcto.',
					solution:
						'IA que lee el correo, lo clasifica y lo reenvía automáticamente.',
					result: '30 min/día ahorrados',
				},
			],
			en: [
				{
					industry: 'Consulting',
					problem:
						'Every morning, 30 min classifying emails and forwarding them to the right department.',
					solution:
						'AI reads the email, classifies it, and forwards it automatically.',
					result: '30 min/day saved',
				},
			],
		},
		startingPrice: '300 €',
		priceUnit: {
			ca: '/mes per integració',
			es: '/mes por integración',
			en: '/month per integration',
		},
		includes: {
			ca: [
				'Configuració del model',
				'Integració amb les teves eines',
				'Ajustaments inicials',
				'Suport continu',
			],
			es: [
				'Configuración del modelo',
				'Integración con tus herramientas',
				'Ajustes iniciales',
				'Soporte continuo',
			],
			en: [
				'Model configuration',
				'Integration with your tools',
				'Initial tuning',
				'Ongoing support',
			],
		},
		excludes: {
			ca: [
				"Costos d'API d'IA (OpenAI, etc.)",
				'Generació de contingut creatiu',
			],
			es: [
				'Costes de API de IA (OpenAI, etc.)',
				'Generación de contenido creativo',
			],
			en: ['AI API costs (OpenAI, etc.)', 'Creative content generation'],
		},
	},
	{
		slug: 'micro-saas',
		name: {
			ca: 'Micro-SaaS',
			es: 'Micro-SaaS',
			en: 'Micro-SaaS',
		},
		tagline: {
			ca: 'Eines petites que fan una cosa bé.',
			es: 'Herramientas pequeñas que hacen una cosa bien.',
			en: 'Small tools that do one thing well.',
		},
		description: {
			ca: "Construïm petites aplicacions web fetes a mida que resolen un problema concret del teu negoci. No són ERPs ni CRMs gegants — són eines petites, ràpides i fàcils d'usar.",
			es: 'Construimos pequeñas aplicaciones web a medida que resuelven un problema concreto de tu negocio. No son ERPs ni CRMs gigantes — son herramientas pequeñas, rápidas y fáciles de usar.',
			en: 'We build small custom web apps that solve a specific problem in your business. Not giant ERPs or CRMs — small, fast, and easy-to-use tools.',
		},
		inputs: {
			ca: ['El teu problema', 'Reunió de descobriment', 'Feedback continu'],
			es: ['Tu problema', 'Reunión de descubrimiento', 'Feedback continuo'],
			en: ['Your problem', 'Discovery meeting', 'Continuous feedback'],
		},
		outputs: {
			ca: [
				'Aplicació web a mida',
				'Accés des de mòbil',
				'Manteniment inclòs',
				'Formació al teu equip',
			],
			es: [
				'Aplicación web a medida',
				'Acceso desde móvil',
				'Mantenimiento incluido',
				'Formación a tu equipo',
			],
			en: [
				'Custom web app',
				'Mobile access',
				'Maintenance included',
				'Team training',
			],
		},
		examples: {
			ca: [
				{
					industry: 'Logística',
					problem:
						"Control d'estoc en un Excel compartit que sempre estava desactualitzat.",
					solution:
						'App web amb escàner de codis de barres i estoc en temps real.',
					result: 'Estoc sempre actualitzat',
				},
			],
			es: [
				{
					industry: 'Logística',
					problem:
						'Control de stock en un Excel compartido que siempre estaba desactualizado.',
					solution:
						'App web con escáner de códigos de barras y stock en tiempo real.',
					result: 'Stock siempre actualizado',
				},
			],
			en: [
				{
					industry: 'Logistics',
					problem:
						'Stock control in a shared spreadsheet that was always outdated.',
					solution: 'Web app with barcode scanner and real-time stock.',
					result: 'Stock always up to date',
				},
			],
		},
		startingPrice: '2.000 €',
		priceUnit: {
			ca: 'desenvolupament + 100 €/mes manteniment',
			es: 'desarrollo + 100 €/mes mantenimiento',
			en: 'development + €100/month maintenance',
		},
		includes: {
			ca: [
				'Disseny UX',
				'Desenvolupament',
				'Deploy i hosting',
				'Manteniment mensual',
			],
			es: [
				'Diseño UX',
				'Desarrollo',
				'Deploy y hosting',
				'Mantenimiento mensual',
			],
			en: [
				'UX design',
				'Development',
				'Deploy & hosting',
				'Monthly maintenance',
			],
		},
		excludes: {
			ca: ['Contingut i dades inicials', 'Integracions no previstes'],
			es: ['Contenido y datos iniciales', 'Integraciones no previstas'],
			en: ['Initial content and data', 'Unplanned integrations'],
		},
	},
]

export function getServiceBySlug(slug: string): Service | undefined {
	return services.find(s => s.slug === slug)
}
