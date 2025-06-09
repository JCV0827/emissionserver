# Emission Server

A Node.js/Express server for emission tracking, designed for deployment on Vercel.

## Features

- Express.js API server
- MySQL database integration
- JWT authentication
- File upload handling
- TOTP 2FA support
- Email notifications

## Deployment

This project is configured for deployment on Vercel. The server will automatically handle routing through the `/api` directory.

## Environment Variables

Make sure to set the following environment variables in your Vercel dashboard:

- `DB_HOST` - MySQL database host
- `DB_USER` - MySQL database username
- `DB_PASSWORD` - MySQL database password
- `DB_NAME` - MySQL database name
- `DB_PORT` - MySQL database port
- `JWT_SECRET` - Secret key for JWT tokens
- `PORT` - Server port (automatically set by Vercel)

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up your environment variables in a `.env` file

3. Run the development server:
   ```bash
   npm run dev
   ```

## API Endpoints

The server provides various endpoints for emission tracking and user management. All routes are accessible through the `/api` prefix when deployed on Vercel.
