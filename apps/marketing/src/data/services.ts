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
	excludes: Record<LangCode, string[]>
}

export const services: Service[] = [
	{
		slug: 'automatitzacions',
		name: {
			ca: 'Automatitzacions i micro-SaaS',
			es: 'Automatizaciones y micro-SaaS',
			en: 'Automation and micro-SaaS',
		},
		tagline: {
			ca: 'Automatitzacions i micro-SaaS a mida per a les tasques setmanals i mensuals que avui et mengen hores i et deixen errors.',
			es: 'Automatizaciones y micro-SaaS a medida para las tareas semanales y mensuales que hoy te comen horas y te dejan errores.',
			en: 'Custom automation and micro-SaaS for the weekly and monthly tasks that today eat hours and leak errors.',
		},
		description: {
			ca: "Agafem les tasques manuals que es repeteixen cada setmana o cada mes — copiar factures, refer llistes de comandes, classificar PDFs, muntar informes des de cinc pestanyes — i les convertim en alguna cosa que es fa sola. Dos modes: **automatització** (connectem les eines que ja fas servir — facturació, correu, full de càlcul, CRM, TPV, formularis, WhatsApp — perquè la informació flueixi sola) o **micro-SaaS** (construïm una petita app web a mida quan et cal un lloc nou per a les dades o una UI mòbil, com escaneig de codis de barres al magatzem). Si el flux ho demana, hi afegim un model d'IA per llegir un correu, extreure dades d'un PDF o resumir una reunió — el judici el fa la màquina, la decisió final és teva.",
			es: 'Cogemos las tareas manuales que se repiten cada semana o cada mes — copiar facturas, rehacer listas de pedidos, clasificar PDFs, montar informes desde cinco pestañas — y las convertimos en algo que se hace solo. Dos modos: **automatización** (conectamos las herramientas que ya usas — facturación, correo, hojas de cálculo, CRM, TPV, formularios, WhatsApp — para que la información fluya sola) o **micro-SaaS** (construimos una pequeña app web a medida cuando necesitas un sitio nuevo para los datos o una UI móvil, como escaneo de códigos de barras en el almacén). Si el flujo lo pide, añadimos un modelo de IA para leer un correo, extraer datos de un PDF o resumir una reunión — el juicio lo hace la máquina, la decisión final es tuya.',
			en: 'We take the manual tasks that repeat every week or every month — copying invoices, rebuilding order lists, classifying PDFs, assembling reports from five tabs — and turn them into something that runs on its own. Two modes: **automation** (we connect the tools you already use — invoicing, email, spreadsheets, CRM, point of sale, web forms, WhatsApp — so information flows on its own) or **micro-SaaS** (we build a small custom web app when you need a new place for data or a mobile UI, like barcode scanning at the warehouse). If the flow calls for it, we add an AI model to read an email, extract data from a PDF, or summarise a meeting — the machine does the judgement, the final decision stays yours.',
		},
		inputs: {
			ca: [
				'Tasques manuals setmanals i mensuals',
				'Factures',
				'Correus',
				'Formularis web',
				'Fulls de càlcul',
				'Documents PDF',
				'Missatges de WhatsApp',
				'Recomptes en paper',
			],
			es: [
				'Tareas manuales semanales y mensuales',
				'Facturas',
				'Correos',
				'Formularios web',
				'Hojas de cálculo',
				'Documentos PDF',
				'Mensajes de WhatsApp',
				'Conteos en papel',
			],
			en: [
				'Weekly and monthly manual tasks',
				'Invoices',
				'Emails',
				'Web forms',
				'Spreadsheets',
				'PDF documents',
				'WhatsApp messages',
				'Paper-based counts',
			],
		},
		outputs: {
			ca: [
				'Registres actualitzats sols',
				'Notificacions automàtiques',
				'Informes generats',
				'Correus classificats i enrutats',
				'Dades extretes de PDFs',
				'Apps web a mida',
				'Accés des del mòbil',
			],
			es: [
				'Registros actualizados solos',
				'Notificaciones automáticas',
				'Informes generados',
				'Correos clasificados y enrutados',
				'Datos extraídos de PDFs',
				'Apps web a medida',
				'Acceso desde el móvil',
			],
			en: [
				'Records updated on their own',
				'Automatic notifications',
				'Generated reports',
				'Classified and routed emails',
				'Data extracted from PDFs',
				'Custom web apps',
				'Mobile access',
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
				{
					industry: 'Assessoria',
					problem:
						'Cada matí, 30 min classificant correus i reenviant-los al departament correcte.',
					solution:
						'IA que llegeix el correu, el classifica i el reenvia automàticament.',
					result: '30 min/dia estalviats',
				},
				{
					industry: 'Logística',
					problem:
						"Control d'estoc en un Excel compartit que sempre estava desactualitzat.",
					solution:
						'App web a mida amb escàner de codis de barres i estoc en temps real.',
					result: 'Estoc sempre actualitzat',
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
				{
					industry: 'Asesoría',
					problem:
						'Cada mañana, 30 min clasificando correos y reenviándolos al departamento correcto.',
					solution:
						'IA que lee el correo, lo clasifica y lo reenvía automáticamente.',
					result: '30 min/día ahorrados',
				},
				{
					industry: 'Logística',
					problem:
						'Control de stock en un Excel compartido que siempre estaba desactualizado.',
					solution:
						'App web a medida con escáner de códigos de barras y stock en tiempo real.',
					result: 'Stock siempre actualizado',
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
				{
					industry: 'Accounting firm',
					problem:
						'Every morning, 30 min classifying emails and forwarding them to the right department.',
					solution:
						'AI reads the email, classifies it, and forwards it automatically.',
					result: '30 min/day saved',
				},
				{
					industry: 'Logistics',
					problem:
						'Stock control in a shared spreadsheet that was always outdated.',
					solution: 'Custom web app with barcode scanner and real-time stock.',
					result: 'Stock always up to date',
				},
			],
		},
		includes: {
			ca: [
				'Reunió de descobriment',
				'Disseny del flux',
				'Implementació a mida',
				"Model d'IA i ajustaments (quan cal)",
				'Desenvolupament de micro-app (quan cal)',
				'Test i posada en marxa',
				'Suport 30 dies',
			],
			es: [
				'Reunión de descubrimiento',
				'Diseño del flujo',
				'Implementación a medida',
				'Modelo de IA y ajustes (cuando hace falta)',
				'Desarrollo de micro-app (cuando hace falta)',
				'Test y puesta en marcha',
				'Soporte 30 días',
			],
			en: [
				'Discovery meeting',
				'Flow design',
				'Custom implementation',
				'AI model and tuning (when needed)',
				'Micro-app development (when needed)',
				'Testing & launch',
				'30-day support',
			],
		},
		excludes: {
			ca: [
				'Subscripcions a tercers (Zapier, Make...)',
				"Costos d'API d'IA (OpenAI, etc.)",
				'Generació de contingut creatiu',
				'Contingut i dades inicials de les apps',
				"Canvis d'abast post-lliurament",
			],
			es: [
				'Suscripciones a terceros (Zapier, Make...)',
				'Costes de API de IA (OpenAI, etc.)',
				'Generación de contenido creativo',
				'Contenido y datos iniciales de las apps',
				'Cambios de alcance post-entrega',
			],
			en: [
				'Third-party subscriptions (Zapier, Make...)',
				'AI API costs (OpenAI, etc.)',
				'Creative content generation',
				'Initial app content and data',
				'Scope changes after delivery',
			],
		},
	},
]

export function getServiceBySlug(slug: string): Service | undefined {
	return services.find(s => s.slug === slug)
}
