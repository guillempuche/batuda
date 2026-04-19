import { useAtomRefresh, useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Crosshair, ExternalLink, MapPin } from 'lucide-react'
import { useEffect, useState } from 'react'
import styled from 'styled-components'

import { PriButton, usePriToast } from '@batuda/ui/pri'

import { companyAtomFor } from '#/atoms/company-atoms'
import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import {
	agedPaperSurface,
	brushedMetalPlate,
	stenciledTitle,
} from '#/lib/workshop-mixins'

// Leaflet is pulled in lazily on the client only. react-leaflet reaches for
// `window` at import time which breaks SSR, so the module is awaited inside
// an effect and the map subtree renders once the handle is available.
type LeafletModules = {
	readonly MapContainer: typeof import('react-leaflet').MapContainer
	readonly TileLayer: typeof import('react-leaflet').TileLayer
	readonly Marker: typeof import('react-leaflet').Marker
	readonly Popup: typeof import('react-leaflet').Popup
	readonly icon: typeof import('leaflet').icon
}

type WherePanelCompany = {
	readonly id: string
	readonly slug: string
	readonly name: string
	readonly location: string | null
	readonly googleMapsUrl: string | null
	readonly latitude: number | null
	readonly longitude: number | null
	readonly geocodeSource: string | null
}

export function WherePanel({
	company,
}: {
	readonly company: WherePanelCompany
}) {
	const { t } = useLingui()
	const toast = usePriToast()
	const refresh = useAtomRefresh(companyAtomFor(company.slug))
	const geocode = useAtomSet(BatudaApiAtom.mutation('companies', 'geocode'), {
		mode: 'promiseExit',
	})

	const hasCoords =
		typeof company.latitude === 'number' &&
		typeof company.longitude === 'number'

	const [pending, setPending] = useState(false)

	const onLocate = async () => {
		if (pending) return
		setPending(true)
		try {
			const exit = await geocode({ params: { id: company.id } } as never)
			if (exit._tag === 'Success') {
				refresh()
				toast.add({
					title: t`Located on the map`,
					description: t`Coordinates saved from the geocoder.`,
					type: 'success',
				})
				return
			}
			toast.add({
				title: t`Could not locate`,
				description: t`The geocoder did not return a match. Try editing the location field.`,
				type: 'error',
			})
		} finally {
			setPending(false)
		}
	}

	const googleHref = buildGoogleMapsHref(company)

	return (
		<Wrap>
			<Header>
				<Title>
					<MapPin size={16} aria-hidden />
					<Trans>Where</Trans>
				</Title>
				{googleHref ? (
					<ExternalLinkButton
						as='a'
						href={googleHref}
						target='_blank'
						rel='noopener noreferrer'
						data-testid='where-google-maps'
					>
						<ExternalLink size={14} aria-hidden />
						<Trans>Open in Google Maps</Trans>
					</ExternalLinkButton>
				) : null}
			</Header>
			{hasCoords ? (
				<MapFrame>
					<LeafletMap
						latitude={company.latitude as number}
						longitude={company.longitude as number}
						label={company.name}
					/>
				</MapFrame>
			) : (
				<EmptyFrame>
					<EmptyCopy>
						{company.location ? (
							<>
								<EmptyLocation>{company.location}</EmptyLocation>
								<EmptyHint>
									<Trans>
										No coordinates yet. Locate this company to plot it on the
										map.
									</Trans>
								</EmptyHint>
							</>
						) : (
							<EmptyHint>
								<Trans>
									Add a location on the Profile tab, then locate this company.
								</Trans>
							</EmptyHint>
						)}
					</EmptyCopy>
					<PriButton
						type='button'
						$variant='filled'
						onClick={onLocate}
						disabled={pending || !company.location}
						data-testid='where-locate'
					>
						<Crosshair size={14} aria-hidden />
						{pending ? (
							<Trans>Locating…</Trans>
						) : (
							<Trans>Locate this company</Trans>
						)}
					</PriButton>
				</EmptyFrame>
			)}
		</Wrap>
	)
}

function buildGoogleMapsHref(company: WherePanelCompany): string | null {
	if (company.googleMapsUrl) return company.googleMapsUrl
	if (
		typeof company.latitude === 'number' &&
		typeof company.longitude === 'number'
	) {
		return `https://www.google.com/maps?q=${company.latitude},${company.longitude}`
	}
	if (company.location) {
		return `https://www.google.com/maps?q=${encodeURIComponent(company.location)}`
	}
	return null
}

function LeafletMap({
	latitude,
	longitude,
	label,
}: {
	readonly latitude: number
	readonly longitude: number
	readonly label: string
}) {
	const [modules, setModules] = useState<LeafletModules | null>(null)

	useEffect(() => {
		let cancelled = false
		Promise.all([import('react-leaflet'), import('leaflet')]).then(
			([rl, L]) => {
				if (cancelled) return
				setModules({
					MapContainer: rl.MapContainer,
					TileLayer: rl.TileLayer,
					Marker: rl.Marker,
					Popup: rl.Popup,
					icon: L.icon,
				})
			},
		)
		return () => {
			cancelled = true
		}
	}, [])

	if (!modules) return <MapPlaceholder aria-hidden />

	const { MapContainer, TileLayer, Marker, Popup, icon } = modules

	// Leaflet ships its marker images via CSS (url()) that vite can't
	// resolve without extra plumbing, so point the default icon at the
	// CDN-hosted assets instead — same thing every Leaflet+bundler guide
	// recommends.
	const defaultIcon = icon({
		iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
		iconRetinaUrl:
			'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
		shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
		iconSize: [25, 41],
		iconAnchor: [12, 41],
		popupAnchor: [1, -34],
		shadowSize: [41, 41],
	})

	return (
		<MapContainer
			center={[latitude, longitude]}
			zoom={12}
			scrollWheelZoom={false}
			style={{ width: '100%', height: '100%' }}
		>
			<TileLayer
				attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
				url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
			/>
			<Marker position={[latitude, longitude]} icon={defaultIcon}>
				<Popup>{label}</Popup>
			</Marker>
		</MapContainer>
	)
}

const Wrap = styled.section.withConfig({ displayName: 'WherePanel' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
`

const Header = styled.header`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-md);
`

const Title = styled.h3`
	${stenciledTitle};
	display: inline-flex;
	align-items: center;
	gap: var(--space-xs);
	font-size: var(--font-size-md);
	margin: 0;
`

const ExternalLinkButton = styled.button`
	display: inline-flex;
	align-items: center;
	gap: var(--space-xs);
	padding: var(--space-xs) var(--space-sm);
	border-radius: var(--radius-sm);
	background: transparent;
	border: 1px solid var(--color-ink-hairline);
	color: var(--color-ink-strong);
	font: inherit;
	font-size: var(--font-size-sm);
	cursor: pointer;
	text-decoration: none;
	transition: background 0.15s ease;

	&:hover {
		background: var(--color-surface-raised);
	}
`

const MapFrame = styled.div`
	${brushedMetalPlate};
	width: 100%;
	height: 320px;
	border-radius: var(--radius-md);

	& > div,
	& .leaflet-container {
		width: 100%;
		height: 100%;
		border-radius: inherit;
	}
`

const MapPlaceholder = styled.div`
	width: 100%;
	height: 100%;
	background: var(--color-surface-raised);
	border-radius: inherit;
`

const EmptyFrame = styled.div`
	${agedPaperSurface};
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--space-md);
	padding: var(--space-lg);
	border-radius: var(--radius-md);
`

const EmptyCopy = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const EmptyLocation = styled.span`
	color: var(--color-ink-strong);
	font-weight: 500;
`

const EmptyHint = styled.span`
	color: var(--color-ink-soft);
	font-size: var(--font-size-sm);
`
