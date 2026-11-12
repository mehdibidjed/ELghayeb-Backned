-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'TEACHER');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'REVIEW');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('AI', 'MANUAL');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('CAPTURING', 'QUEUED', 'PROCESSING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "teachers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'TEACHER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" SERIAL NOT NULL,
    "matricule" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "face_embeddings" (
    "id" SERIAL NOT NULL,
    "student_id" INTEGER NOT NULL,
    "vector" DOUBLE PRECISION[],
    "det_score" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "face_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "depth_m" DOUBLE PRECISION,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "room_id" INTEGER,
    "token_hash" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_seen" TIMESTAMP(3),
    "last_ip" TEXT,
    "info" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" SERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "room_id" INTEGER NOT NULL,
    "teacher_id" INTEGER NOT NULL,
    "subject" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "behavior_active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_runs" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'CAPTURING',
    "shots" INTEGER NOT NULL,
    "faces_found" INTEGER,
    "error" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "attendance_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER NOT NULL,
    "student_id" INTEGER NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "source" "AttendanceSource" NOT NULL DEFAULT 'AI',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "behavior_stats" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER NOT NULL,
    "minute" TIMESTAMP(3) NOT NULL,
    "samples" INTEGER NOT NULL DEFAULT 0,
    "persons" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "attentive_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "phone_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "head_down_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hand_up_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "behavior_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teachers_email_key" ON "teachers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "groups_name_key" ON "groups"("name");

-- CreateIndex
CREATE UNIQUE INDEX "students_matricule_key" ON "students"("matricule");

-- CreateIndex
CREATE INDEX "students_group_id_idx" ON "students"("group_id");

-- CreateIndex
CREATE INDEX "face_embeddings_student_id_idx" ON "face_embeddings"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_name_key" ON "rooms"("name");

-- CreateIndex
CREATE UNIQUE INDEX "devices_token_hash_key" ON "devices"("token_hash");

-- CreateIndex
CREATE INDEX "devices_room_id_idx" ON "devices"("room_id");

-- CreateIndex
CREATE INDEX "sessions_teacher_id_starts_at_idx" ON "sessions"("teacher_id", "starts_at");

-- CreateIndex
CREATE INDEX "attendance_runs_session_id_idx" ON "attendance_runs"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_session_id_student_id_key" ON "attendance"("session_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "behavior_stats_session_id_minute_key" ON "behavior_stats"("session_id", "minute");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "face_embeddings" ADD CONSTRAINT "face_embeddings_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_runs" ADD CONSTRAINT "attendance_runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behavior_stats" ADD CONSTRAINT "behavior_stats_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
