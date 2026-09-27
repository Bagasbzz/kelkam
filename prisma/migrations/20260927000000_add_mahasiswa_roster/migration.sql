-- CreateTable
CREATE TABLE "mahasiswas" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "class_id" TEXT,
    "nim" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mahasiswas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mahasiswas_course_id_nim_key" ON "mahasiswas"("course_id", "nim");

-- CreateIndex
CREATE INDEX "mahasiswas_course_id_class_id_idx" ON "mahasiswas"("course_id", "class_id");

-- AddForeignKey
ALTER TABLE "mahasiswas" ADD CONSTRAINT "mahasiswas_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mahasiswas" ADD CONSTRAINT "mahasiswas_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "course_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;