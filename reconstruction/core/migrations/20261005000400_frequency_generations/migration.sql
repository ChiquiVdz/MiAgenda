ALTER TABLE public.series_segments ADD COLUMN "ordinalOffset" bigint NOT NULL DEFAULT 0;
ALTER TABLE public.series_segments ADD COLUMN "protectedOnly" boolean NOT NULL DEFAULT false;
ALTER TABLE public.series_segments ADD COLUMN "protectedRanges" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.series_segments ADD CONSTRAINT segment_generation_bounds CHECK (
  "ordinalOffset" >= 0 AND "ordinalOffset" <= 2140000000
  AND jsonb_typeof("protectedRanges") = 'array'
  AND "fromOrdinal" >= "ordinalOffset"
  AND "fromOrdinal" < "ordinalOffset" + 4000001
  AND ("toOrdinal" IS NULL OR "toOrdinal" <= "ordinalOffset" + 4000001)
);
