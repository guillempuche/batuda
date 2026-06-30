import { Trans } from '@lingui/react/macro'
import type { ReactNode } from 'react'
import styled from 'styled-components'

import { type Agent, agents } from '@batuda/instructions/domain'
import { PriToggleGroup } from '@batuda/ui/pri'

// Instructions are per surface: each agent (research, email, …) keeps its own
// default stack. This toggle picks which surface the default-stack section below
// it configures. The surface list comes straight from the server's agent set, so
// a new surface appears here with no extra wiring — only a label is needed.
const AGENT_LABELS: Record<Agent, ReactNode> = {
	research: <Trans>Research</Trans>,
	email: <Trans>Email</Trans>,
}

export function AgentSelector({
	agent,
	onChange,
	labelledBy,
}: {
	readonly agent: Agent
	readonly onChange: (agent: Agent) => void
	// Id of the visible heading that names this control, so a screen reader
	// announces what the surface choice governs instead of two bare buttons.
	readonly labelledBy: string
}) {
	return (
		<Root
			aria-labelledby={labelledBy}
			value={[agent]}
			onValueChange={(values: string[]) => {
				const next = values[0]
				if (next && (agents as ReadonlyArray<string>).includes(next)) {
					onChange(next as Agent)
				}
			}}
		>
			{agents.map(value => (
				<PriToggleGroup.Item key={value} value={value}>
					{AGENT_LABELS[value]}
				</PriToggleGroup.Item>
			))}
		</Root>
	)
}

const Root = styled(PriToggleGroup.Root)`
	align-self: flex-start;
`
