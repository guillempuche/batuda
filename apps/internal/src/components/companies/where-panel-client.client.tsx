import { useAtomRefresh, useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { icon } from 'leaflet'
import { Crosshair, ExternalLink, MapPin, Maximize2 } from 'lucide-react'
import { css, styled } from 'next-yak'
import { useEffect, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'

import { PriButton, PriDialog, usePriToast } from '@batuda/ui/pri'

import { companyAtomFor } from '#/atoms/company-atoms'
import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import {
	agedPaperSurface,
	brushedMetalPlate,
	stenciledTitle,
} from '#/lib/workshop-mixins'

import 'leaflet/dist/leaflet.css'

import { useTheme } from '#/theme/theme-provider'

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
	compact = false,
}: {
	readonly company: WherePanelCompany
	readonly compact?: boolean
}) {
	const { t } = useLingui()
	const theme = useTheme()
	const toast = usePriToast()
	const refresh = useAtomRefresh(companyAtomFor(company.slug))
	const geocode = useAtomSet(BatudaApiAtom.mutation('companies', 'geocode'), {
		mode: 'promiseExit',
	})

	const hasCoords =
		typeof company.latitude === 'number' &&
		typeof company.longitude === 'number'

	const [pending, setPending] = useState(false)
	const [expanded, setExpanded] = useState(false)

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
				<HeaderActions>
					{hasCoords ? (
						<ExternalLinkButton
							type='button'
							onClick={() => setExpanded(true)}
							aria-label={t`Open the map full screen`}
							data-testid='where-expand'
						>
							<Maximize2 size={14} aria-hidden />
						</ExternalLinkButton>
					) : null}
					{googleHref ? (
						<ExternalLinkAnchor
							href={googleHref}
							target='_blank'
							rel='noopener noreferrer'
							data-testid='where-google-maps'
						>
							<ExternalLink size={14} aria-hidden />
							<Trans>Open in Google Maps</Trans>
						</ExternalLinkAnchor>
					) : null}
				</HeaderActions>
			</Header>
			{hasCoords ? (
				<>
					<MapFrame
						$compact={compact}
						data-map-theme={theme === 'light' ? 'light' : 'dark'}
					>
						<LeafletMap
							latitude={company.latitude as number}
							longitude={company.longitude as number}
							label={company.name}
							dark={theme !== 'light'}
						/>
					</MapFrame>
					<PriDialog.Root open={expanded} onOpenChange={setExpanded}>
						<PriDialog.Portal>
							<PriDialog.Backdrop />
							<PriDialog.Viewport>
								<MapPopup mobile='sheet' data-testid='where-fullscreen'>
									<PriDialog.Title>{company.name}</PriDialog.Title>
									<FullMapFrame
										data-map-theme={theme === 'light' ? 'light' : 'dark'}
									>
										<LeafletMap
											latitude={company.latitude as number}
											longitude={company.longitude as number}
											label={company.name}
											dark={theme !== 'light'}
											// Room to look properly: the wheel works and it opens
											// close enough to read a street.
											zoom={13}
											scrollWheelZoom
										/>
									</FullMapFrame>
									<PriDialog.Close
										render={
											<PriButton type='button' $variant='outlined'>
												{t`Close`}
											</PriButton>
										}
									/>
								</MapPopup>
							</PriDialog.Viewport>
						</PriDialog.Portal>
					</PriDialog.Root>
				</>
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

/**
 * Tell the map to re-measure whenever its frame changes size.
 *
 * A map opened inside a dialog is built while the dialog is still animating in,
 * so it works out which tiles to fetch against a box that is about to change —
 * and the ones for the rest of the frame never arrive, leaving a blank band.
 */
function ResizeToFrame() {
	const map = useMap()
	useEffect(() => {
		const frame = map.getContainer()
		const observer = new ResizeObserver(() => {
			map.invalidateSize()
		})
		observer.observe(frame)
		return () => {
			observer.disconnect()
		}
	}, [map])
	return null
}

function LeafletMap({
	latitude,
	longitude,
	label,
	dark,
	zoom = 6,
	scrollWheelZoom = false,
}: {
	readonly latitude: number
	readonly longitude: number
	readonly label: string
	readonly dark: boolean
	/**
	 * Where the map opens. The default answers "which part of the country is
	 * this?", which is what the panel is for — closer in, the tiles name only
	 * suburbs and the nearest city one has heard of is off the edge. The +/-
	 * controls are there for anyone who wants the street.
	 */
	readonly zoom?: number
	readonly scrollWheelZoom?: boolean
}) {
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
			zoom={zoom}
			scrollWheelZoom={scrollWheelZoom}
			style={{ width: '100%', height: '100%' }}
		>
			<ResizeToFrame />
			<TileLayer
				attribution={
					dark
						? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
						: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
				}
				url={
					dark
						? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
						: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
				}
			/>
			<Marker position={[latitude, longitude]} icon={defaultIcon}>
				<Popup>{label}</Popup>
			</Marker>
		</MapContainer>
	)
}

const Wrap = styled.section`
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
	font-size: var(--typescale-body-medium-size);
	margin: 0;
`

const HeaderActions = styled.div`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-2xs);
`

const externalControl = css`
	display: inline-flex;
	align-items: center;
	gap: var(--space-xs);
	padding: var(--space-xs) var(--space-sm);
	border-radius: var(--shape-sm);
	background: transparent;
	border: 1px solid var(--color-outline-variant);
	color: var(--color-on-surface);
	font: inherit;
	font-size: var(--typescale-body-small-size);
	cursor: pointer;
	text-decoration: none;
	transition: background 0.15s ease;

	&:hover {
		background: var(--color-surface-container-low);
	}
`

const ExternalLinkButton = styled.button`
	${externalControl}
`

/* Same control, but one that navigates — so it is an anchor, not a button. */
const ExternalLinkAnchor = styled.a`
	${externalControl}
`

const MapFrame = styled.div<{ $compact: boolean }>`
	${brushedMetalPlate};
	width: 100%;
	height: ${p => (p.$compact ? '180px' : '320px')};
	border-radius: var(--shape-md);

	/* The tiles themselves come from a dark basemap in the dark themes, so they
	 * need no correction here. Leaflet's own popups, buttons and credit line
	 * ship their own light CSS and are restyled to match the page. */
	&[data-map-theme='dark'] .leaflet-popup-content-wrapper,
	&[data-map-theme='dark'] .leaflet-popup-tip,
	&[data-map-theme='dark'] .leaflet-bar a {
		background: var(--color-surface-container-high);
		color: var(--color-on-surface);
	}

	&[data-map-theme='dark'] .leaflet-bar a {
		border-bottom-color: var(--color-outline-variant);
	}

	&[data-map-theme='dark'] .leaflet-control-attribution {
		background: color-mix(in oklab, var(--color-surface) 80%, transparent);
		color: var(--color-on-surface-variant);
	}

	&[data-map-theme='dark'] .leaflet-control-attribution a {
		color: var(--color-primary);
	}

	& > div,
	& .leaflet-container {
		width: 100%;
		height: 100%;
		border-radius: inherit;
	}
`

/* A dialog holding a map wants the window, not the width a form reads best at,
 * which is what the shared popup is sized for. */
const MapPopup = styled(PriDialog.Popup)`
	width: min(90vw, 80rem);
	max-width: min(90vw, 80rem);
`

const FullMapFrame = styled.div`
	${brushedMetalPlate};
	width: 100%;
	/* Tall enough to be worth opening, and it gives way on a short window
	 * instead of pushing the close button off the bottom. The dialog lays its
	 * children out in a column, so without this the map is the one that gets
	 * squeezed down to nothing. */
	height: min(70vh, 40rem);
	flex: 0 0 auto;
	border-radius: var(--shape-md);

	& > div,
	& .leaflet-container {
		width: 100%;
		height: 100%;
		border-radius: inherit;
	}
`

const EmptyFrame = styled.div`
	${agedPaperSurface};
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--space-md);
	padding: var(--space-lg);
	border-radius: var(--shape-md);
`

const EmptyCopy = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const EmptyLocation = styled.span`
	color: var(--color-on-surface);
	font-weight: var(--font-weight-medium);
`

const EmptyHint = styled.span`
	color: var(--color-on-surface-variant);
	font-size: var(--typescale-body-small-size);
`
