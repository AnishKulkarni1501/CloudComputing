# ForumHub

ForumHub is a full-stack discussion board where users can create accounts, publish and edit posts, comment, and upvote. It uses React, an Express REST API, MongoDB, and JWT-based authentication. The app is containerized and configured for deployment on AWS.

## Features

- Sign up/sign in with bcrypt password hashing and expiring JWTs
- Create, edit, and delete your own posts
- Attach up to five photos or videos to a post
- Add, edit, and delete your own comments
- Toggle upvotes and sort by newest or most popular
- API health endpoint at `/health`, including MongoDB readiness
- Docker images for the UI and API, with a local MongoDB Compose stack
- Optional S3 media storage and SQS event publishing; development uses local media storage

## Run locally

Requirements: Node.js 20+ and Docker Desktop (or a local MongoDB instance).

```sh
docker compose up --build
```

Open `http://localhost:3000`; the API is at `http://localhost:5000`. Compose uses a persistent Docker volume for MongoDB. For a non-containerized API, copy `.env.example` to `.env`, set `MONGODB_URI` and a long random `JWT_SECRET`, then run `npm install`, `npm run server`, and in another terminal `npm start`.

The React API URL is selected at build time with `REACT_APP_API_URL` (default `http://localhost:5000`). Do not put credentials or secrets in React environment variables; they are embedded in public browser assets.

## AWS deployment design

See [AWS_DEPLOYMENT.md](AWS_DEPLOYMENT.md) for the target architecture and deployment steps. The project is prepared for an AWS-hosted static React site and containerized API. The guide distinguishes the deployment design from resources that have actually been provisioned; no AWS account resources have been created by this repository change.

## Resume version

**ForumHub — Cloud-Ready Community Discussion Platform** | React, Node.js, Express, MongoDB, Docker, AWS

- Built a full-stack forum with JWT-authenticated accounts, post creation/editing, photo and video attachments, editable comments, and upvotes.
- Developed REST APIs with bcrypt password hashing, expiring JWTs, and author-based permissions for posts and comments.
- Added short-lived, size-limited S3 media uploads and SQS event publishing for post, comment, vote, and media actions.
- Containerized the React client and Express API and added Docker Compose with persistent MongoDB storage for repeatable local development.
- Prepared AWS hosting with S3/CloudFront, ECR/ECS Fargate, an Application Load Balancer, Secrets Manager, and CloudWatch.

The app supports S3 and SQS when configured, but the AWS resources and event consumers still need deployment. Only say “deployed on AWS” after verifying the full setup. Add performance metrics only after measuring them.

## Interview explanation

“ForumHub is a discussion application built with React, an Express REST API, and MongoDB. Users create accounts, manage posts, attach photos and videos, edit comments, and upvote. The API uses bcrypt, expiring JWTs, and author checks. Media uploads use short-lived S3 forms when AWS is configured, and domain actions can publish events to SQS. I containerized the frontend and API and added Docker Compose for local development. The AWS target runs the API on ECS Fargate behind an Application Load Balancer and serves the static app through CloudFront and S3. The AWS resources and event consumers still need to be provisioned.”

## Stack

- Frontend: React 19
- API: Node.js, Express, JWT, bcrypt
- Database: MongoDB with Mongoose
- Cloud deployment target: AWS S3, CloudFront, ECR, ECS Fargate, Application Load Balancer, SQS, Secrets Manager, CloudWatch
- Local environment: Docker, Docker Compose
