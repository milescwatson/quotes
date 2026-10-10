# Nuxt Minimal Starter

Look at the [Nuxt documentation](https://nuxt.com/docs/getting-started/introduction) to learn more.

## Setup

Make sure to install dependencies:

```bash
# npm
npm install

# pnpm
pnpm install

# yarn
yarn install

# bun
bun install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
# npm
npm run dev

# pnpm
pnpm dev

# yarn
yarn dev

# bun
bun run dev
```

## Production

Build the application for production:

```bash
# npm
npm run build

# pnpm
pnpm build

# yarn
yarn build

# bun
bun run build
```

Locally preview production build:

```bash
# npm
npm run preview

# pnpm
pnpm preview

# yarn
yarn preview

# bun
bun run preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.

## AWS development deployment

Pushes to the `development` branch automatically deploy the frontend to Amplify
in the `quotes-development` AWS account (`415221799122`, `us-west-2`):

https://development.d8i1ve5prnr7w.amplifyapp.com

`amplify.yml` builds with Node 22 and Nitro's `aws-amplify` preset. The app is
currently the Nuxt starter. The infrastructure smoke-test API is:

https://um0ix9fu4i.execute-api.us-west-2.amazonaws.com/health

Terraform and API deployments run locally from the sibling `AWS` directory,
which is outside this Git repository. Git pushes rebuild only the frontend.
`main` is not connected to Amplify. Staging and production are not deployed.
