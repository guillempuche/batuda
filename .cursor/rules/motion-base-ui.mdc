---
description: Animating Base UI components with Motion for React
globs: *.tsx, *.jsx
alwaysApply: false
---

# Animating Base UI with Motion for React

When creating a Base UI animation using Motion for React, pass a `motion` component via the Base UI render prop:

```jsx
<Menu.Popup
  render={
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} // etc
```

Don't use the function/spread props approach as this will cause type errors.

## Exit animations

In most situations, you can animate Base UI components as they leave the DOM using AnimatePresence and the exit prop, as usual:

```jsx
<AnimatePresence>
    {open && (
        <Menu.Trigger
            render={
                <motion.button
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                />
            }
        />
    )}
</AnimatePresence>
```

However, some Base UI components like `ContextMenu` and `Popover` control this conditional rendering themselves. To add exit animations to these components, we must:

1. Hoist their open state
2. Add `keepMounted` to their `Portal` component
3. Conditionally render the `Portal` component with `AnimatePresence`

A component's open state can be hoisted by defining it manually with useState:

```jsx
const [open, setOpen] = useState(false)

return (
  <ContextMenu.Root open={open} onOpenChange={setOpen}>
```

Then, conditionally render the `Portal` (with a `keepMounted` prop) as a child of `AnimatePresence`:

```jsx
return (
   <ContextMenu.Root open={open} onOpenChange={setOpen}>
    <ContextMenu.Trigger>Open menu</ContextMenu.Trigger>
    <AnimatePresence>
      {open && (
        <ContextMenu.Portal keepMounted>
```

We can then add an exit animation via a motion component rendered via a render prop:

```jsx
function App() {
  const [open, setOpen] = useState(false)

  return (
    <ContextMenu.Root open={open} onOpenChange={setOpen}>
      <ContextMenu.Trigger>Open menu</ContextMenu.Trigger>
      <AnimatePresence>
        {open && (
          <ContextMenu.Portal keepMounted>
            <ContextMenu.Positioner>
              <ContextMenu.Popup
                render={
                  <motion.div
                    initial={{ opacity: 0, transform: "scale(0.9)" }}
                    animate={{ opacity: 1, transform: "scale(1)" }}
                    exit={{ opacity: 0, transform: "scale(0.9)" }}
                  />
                }
              >
                {/* Children */}
              </ContextMenu.Popup>
```

Note: `Portal` will keep the tree mounted as long as Base UI detects animations on an element using element.getAnimations(). Motion will run `opacity`, `transform`, `filter`, and `clipPath` animations via hardware acceleration, so ensure at least one of these values is used for the exit animation.
