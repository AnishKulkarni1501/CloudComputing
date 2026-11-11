# AWS deployment guide

This is the intended AWS hosting design for ForumHub. It is a deployment guide, not proof that the resources have already been created.

## Target architecture: forum events, media jobs, and ECS auto scaling

```text
                           ┌─────────────────────────────┐
                           │        CloudFront           │
                           └──────────────┬──────────────┘
                                  serves  │
                         ┌───────────────▼──────────────┐
                         │ Private S3: React web assets │
                         └──────────────────────────────┘
 Browser ── HTTPS ──┬──> CloudFront (web app)
                    │
                    ├── API calls ──> HTTPS ALB ──> ECS Fargate API service
                    │                              │   auto scales ECS tasks by CPU/request load
                    │                              ├──> MongoDB Atlas (users/posts/comments/votes/media metadata)
                    │                              ├──> SQS publisher (post/comment/vote events)
                    │                              ├──> Secrets Manager (DB URI/JWT secret)
                    │                              └──> CloudWatch Logs/metrics
                    │
                    │               SQS forum-events queue ──> DLQ
                    │                        │
                    │                        ▼
                    │           ECS Fargate forum-event workers
                    │           auto scales from queue backlog
                    │           (notifications/moderation/feed work)
                    │
                    └── direct, short-lived presigned PUT ──> Private S3 media bucket
                                                               │
                                                               │ media job
                                                               ▼
                                                        SQS media-jobs queue ──> DLQ
                                                               │
                                                               ▼
                                                   ECS Fargate media-worker service
                                                   auto scales ECS tasks by SQS backlog
                                                               │
                                             validate / extract metadata / thumbnails
                                                               │
                                                               └──> S3 media/derivatives
```

- **S3 + CloudFront:** Host the compiled React app in a private S3 bucket behind CloudFront Origin Access Control. Store original photos/videos and processed derivatives in a separate private S3 media bucket. The browser uploads media directly to S3 using a short-lived, size-limited presigned form returned by the API; keep file metadata and ownership in MongoDB. Local development falls back to the API's `uploads/` directory when `S3_BUCKET` is unset.
- **ECR + ECS Fargate + ALB:** Store and run the HTTP API image in ECS. Use private subnets for tasks and an internet-facing ALB in public subnets. The ALB forwards to port `5000` and uses `/health` for target health checks.
- **SQS + DLQs:** Send domain events for `post.created`, `post.updated`, `post.deleted`, `comment.created`, `comment.deleted`, and `post.upvote_changed` to a forum-events queue. Send confirmed media uploads to a separate media-jobs queue so video processing cannot delay short forum jobs. Configure a DLQ and retry policy for each queue. SQS is a queue, not an ordered event-stream service.
- **SQS publishing:** The API publishes post, comment, vote, and confirmed-media events after persisting user actions. SQS provides asynchronous handoff and retryable consumption. Current publishing logs SQS send failures; it does not yet use a transactional outbox, so production reliability should add an outbox publisher before relying on events for critical business actions. Consumers should be idempotent because SQS can deliver a message more than once.
- **ECS event workers:** Run event consumers as ECS services separate from the API. They can perform asynchronous notifications, moderation checks, or feed/search indexing without slowing the user-facing write request. The API still persists and returns the post/comment action synchronously; the queue handles follow-up work.
- **ECS Service Auto Scaling:** Scale the API service's ECS task count using CPU, memory, or ALB requests per target. Scale forum-event and media-worker ECS services independently from their respective SQS backlog per task. ECS scales tasks; with Fargate there are no customer-managed EC2 instances to scale. If using ECS on EC2 instead, pair service task scaling with an ECS capacity provider to scale the underlying EC2 Auto Scaling group.
- **Secrets Manager and IAM task roles:** Supply `MONGODB_URI` and `JWT_SECRET` as secrets. Give the API task role S3 object access for its media bucket and `sqs:SendMessage` on configured queues. Give worker roles only the queue and S3 permissions they need.
- **CloudWatch:** Send API and worker logs to CloudWatch and monitor ALB errors/latency, ECS task health, SQS backlog/oldest message age, and S3 upload failures.
- **MongoDB:** This app currently uses MongoDB/Mongoose; the AWS target can use MongoDB Atlas with TLS and network access restricted to the deployment egress. Amazon DocumentDB would require compatibility validation and is not a drop-in promise.

## Deployment outline

1. Create an ECR repository and build/push the API image. The API already supports S3 presigned uploads and optional SQS event publishing. The forum-event and media-job consumer services still need implementation before asynchronous jobs can be processed.

   ```sh
   aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
   docker build -f src/backend/Dockerfile -t forumhub-api .
   docker tag forumhub-api:latest <account>.dkr.ecr.<region>.amazonaws.com/forumhub-api:latest
   docker push <account>.dkr.ecr.<region>.amazonaws.com/forumhub-api:latest
   ```

2. Create an ECS Fargate task definition with the API image, `PORT=5000`, a CloudWatch log driver, Secrets Manager references for `MONGODB_URI` and `JWT_SECRET`, and task-role permissions for `s3:PutObject`, `s3:GetObject`, and `sqs:SendMessage` scoped to the configured bucket and queues. Prefer presigned uploads so the API does not proxy large media bodies.
3. Create a VPC with public ALB subnets and private task subnets, security groups allowing HTTPS to the ALB and port 5000 only from the ALB to the tasks, then create an ECS service with desired task count and `/health` target checks.
4. Deploy the frontend build to a private S3 bucket and put CloudFront in front of it. Build with the API's HTTPS endpoint:

   ```sh
   docker build --build-arg REACT_APP_API_URL=https://<api-domain> -t forumhub-web .
   ```

   For a static S3 upload, use `npm ci`, `REACT_APP_API_URL=https://<api-domain> npm run build`, then sync the generated `build/` directory to the bucket. Configure CloudFront SPA fallback to `index.html` and invalidate the distribution after releases.

5. Create private S3 media storage with CORS allowing the frontend origin to POST uploads, plus an SQS forum-events queue and DLQ and a separate SQS media-jobs queue and DLQ. Set `S3_BUCKET`, `FORUM_EVENTS_QUEUE_URL`, and `MEDIA_JOBS_QUEUE_URL` on the API. Implement idempotent ECS consumers and an outbox publisher before treating queue delivery as reliable. Configure ECS Service Auto Scaling for each worker service using backlog per task; verify retries, duplicate delivery, and DLQ redrive.
6. Set `CORS_ORIGIN` on the API to the exact CloudFront site origin, configure TLS certificates and DNS, and verify the frontend, sign-in, post/comment/upvote writes, `/health`, media upload, event processing, and CloudWatch logs.

## Operational considerations

- Set ECS task scaling from CPU/memory or request load and use at least two tasks for availability once the workload warrants the cost.
- Use rolling deployments and a tested rollback path; monitor ALB 5xx/latency and ECS task restarts.
- MongoDB Atlas network rules and credentials must be configured for the chosen VPC egress path.
- Local media files are stored in a Docker volume; production media is stored in S3. Add a retention/lifecycle policy for abandoned uploads and remove S3 objects when users delete attachments or posts.
- SQS publishing currently happens after the MongoDB write and logs failures; add a transactional outbox before relying on queue events for critical side effects.
- The current API stores comments and upvotes embedded in MongoDB post documents. Review document growth, pagination, and indexes before production scale.
- JWTs are currently stored in browser local storage. For a production threat model, evaluate secure, HttpOnly cookie sessions and CSRF controls.
