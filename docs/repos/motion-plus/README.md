<p align="center">
  <img width="32" height="32" alt="Motion logo" src="https://github.com/user-attachments/assets/64ba6b46-1532-4555-a1de-100f8ee8fcd5" alt="Motion+ logo" />
</p>
<h1 align="center">Motion+</h1>

This repo contains the source code for premium Motion+ APIs like `Cursor` and `AnimatenNumber`, as well as our `.cursor/rules`.

### 🧠 Cursor

Our [Cursor](https://www.cursor.com/) rules files live in `/.cursor/rules`. There's a seperate file each for vanilla Motion, and Motion for React.

To install, you can copy the files to your project's `/.cursor/rules` directory.

You can automatically apply rules by adding filetypes to the Globs field.

<img width="226" alt="Screenshot of the Globs field" src="https://github.com/user-attachments/assets/3cef53b2-3d41-434c-9797-fa8c7da43e87" />

The Agent will also decide when to follow these rules based on the description.

Or you can include Motion rules in every chat by saving the file as `/.cursorrules`, going to `Cursor > Settings... > Cursor Settings` and selecting "Always include `.cursorrules`".

<img width="463" alt="Screenshot of the Cursor Settings dialog" src="https://github.com/user-attachments/assets/5b1bfb80-199e-43c0-8e69-60e83db4fe64" />

### 🧑‍💻 Develop

Run `yarn` to install dependencies.

Run `yarn dev` to spin up a local dev site at `localhost:3000`.

This Next.js site contains test files for Motion+ components that live at `/dev/react-env/src/app/tests/[slug]/components`.

`yarn test` will run Playwright tests against this Next.js server. These tests live in the `/tests` folder.
