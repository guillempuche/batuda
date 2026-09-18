import { ChevronsUpDown } from 'lucide-react'

import { PriSelect } from '@batuda/ui/pri'

// Stands for "no narrowing" in any of these dropdowns: a select always points
// at one of its own options, and this is the option that means none. One
// spelling for every filter that offers it, since the value reaches the address.
export const ALL = '__all__'

// One filter of a list's bar that holds a single value: the trigger shows what
// it is set to rather than what it filters, since several sit on a line and
// there is room for one of the two. The name is left to anyone listening.
export function FilterSelect({
	label,
	value,
	options,
	onChange,
	testId,
}: {
	readonly label: string
	readonly value: string
	readonly options: ReadonlyArray<{ value: string; label: string }>
	readonly onChange: (value: string) => void
	readonly testId: string
}) {
	return (
		<PriSelect.Root
			items={options}
			value={value}
			onValueChange={v => {
				if (typeof v === 'string') onChange(v)
			}}
		>
			<PriSelect.Trigger data-testid={testId} aria-label={label}>
				<PriSelect.Value />
				<PriSelect.Icon>
					<ChevronsUpDown size={14} aria-hidden />
				</PriSelect.Icon>
			</PriSelect.Trigger>
			<PriSelect.Options
				items={options}
				sideOffset={6}
				optionTestId={v => `${testId}-option-${v}`}
			/>
		</PriSelect.Root>
	)
}
