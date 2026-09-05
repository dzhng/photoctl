--
-- PostgreSQL database dump
--


-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner:
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: refresh_file_search_text(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.refresh_file_search_text() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    PERFORM refresh_photo_search_text(OLD.photo_id);
  END IF;
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    PERFORM refresh_photo_search_text(NEW.photo_id);
  END IF;
  RETURN NULL;
END
$$;


ALTER FUNCTION public.refresh_file_search_text() OWNER TO postgres;

--
-- Name: refresh_photo_search_text(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.refresh_photo_search_text(target_photo_id uuid) RETURNS void
    LANGUAGE sql
    AS $$
  UPDATE photos
  SET search_text = concat_ws(
    ' ',
    COALESCE((SELECT string_agg(regexp_replace(rel_path, '[^[:alnum:]]+', ' ', 'g'), ' ' ORDER BY rel_path)
              FROM files WHERE photo_id = target_photo_id), ''),
    COALESCE((SELECT string_agg(regexp_replace(tag, '[^[:alnum:]]+', ' ', 'g'), ' ' ORDER BY tag)
              FROM tags WHERE photo_id = target_photo_id), '')
  )
  WHERE id = target_photo_id
$$;


ALTER FUNCTION public.refresh_photo_search_text(target_photo_id uuid) OWNER TO postgres;

--
-- Name: refresh_tag_search_text(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.refresh_tag_search_text() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    PERFORM refresh_photo_search_text(OLD.photo_id);
  END IF;
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    PERFORM refresh_photo_search_text(NEW.photo_id);
  END IF;
  RETURN NULL;
END
$$;


ALTER FUNCTION public.refresh_tag_search_text() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: cache_index; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cache_index (
    path text NOT NULL,
    bytes bigint NOT NULL,
    last_used timestamp with time zone NOT NULL,
    pinned boolean DEFAULT false NOT NULL,
    CONSTRAINT cache_index_bytes_check CHECK ((bytes >= 0))
);


ALTER TABLE public.cache_index OWNER TO postgres;

--
-- Name: document_revision_layers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.document_revision_layers (
    photo_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    layer_id uuid NOT NULL,
    name text NOT NULL,
    z integer NOT NULL,
    content_node_id text NOT NULL,
    mask_node_id text NOT NULL,
    opacity double precision NOT NULL,
    blend text NOT NULL,
    enabled boolean NOT NULL,
    CONSTRAINT document_revision_layers_blend_check CHECK ((blend = 'normal'::text)),
    CONSTRAINT document_revision_layers_opacity_check CHECK (((opacity >= (0)::double precision) AND (opacity <= (1)::double precision))),
    CONSTRAINT document_revision_layers_z_check CHECK ((z >= 0))
);


ALTER TABLE public.document_revision_layers OWNER TO postgres;

--
-- Name: document_revision_roots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.document_revision_roots (
    revision_id uuid NOT NULL,
    photo_id uuid NOT NULL,
    root_name text NOT NULL,
    node_id text NOT NULL,
    CONSTRAINT document_revision_roots_name_check CHECK ((root_name = ANY (ARRAY['base'::text, 'output'::text])))
);


ALTER TABLE public.document_revision_roots OWNER TO postgres;

--
-- Name: document_revisions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.document_revisions (
    id uuid NOT NULL,
    photo_id uuid NOT NULL,
    parent_revision_id uuid,
    pinned boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb,
    CONSTRAINT document_revisions_metadata_check CHECK (((metadata IS NULL) OR (jsonb_typeof(metadata) = 'object'::text)))
);


ALTER TABLE public.document_revisions OWNER TO postgres;

--
-- Name: embeddings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.embeddings (
    photo_id uuid NOT NULL,
    model text NOT NULL,
    vec public.halfvec(3072) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.embeddings OWNER TO postgres;

--
-- Name: exports; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.exports (
    id bigint NOT NULL,
    photo_id uuid NOT NULL,
    path text NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    render_hash text NOT NULL,
    bytes bigint NOT NULL,
    CONSTRAINT exports_bytes_check CHECK ((bytes > 0))
);


ALTER TABLE public.exports OWNER TO postgres;

--
-- Name: exports_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.exports ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.exports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: files; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.files (
    id uuid NOT NULL,
    photo_id uuid NOT NULL,
    volume_uuid text NOT NULL,
    rel_path text NOT NULL,
    mtime timestamp with time zone NOT NULL,
    embedded jsonb DEFAULT '[]'::jsonb NOT NULL
);


ALTER TABLE public.files OWNER TO postgres;

--
-- Name: image_artifacts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.image_artifacts (
    artifact_hash text NOT NULL,
    media_type text NOT NULL,
    bytes bigint NOT NULL,
    w integer NOT NULL,
    h integer NOT NULL,
    artifact_available boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT image_artifacts_artifact_hash_check CHECK ((artifact_hash ~ '^a_[0-9a-f]{64}$'::text)),
    CONSTRAINT image_artifacts_bytes_check CHECK ((bytes >= 0)),
    CONSTRAINT image_artifacts_h_check CHECK ((h > 0)),
    CONSTRAINT image_artifacts_w_check CHECK ((w > 0))
);


ALTER TABLE public.image_artifacts OWNER TO postgres;

--
-- Name: image_node_inputs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.image_node_inputs (
    photo_id uuid NOT NULL,
    node_id text NOT NULL,
    input_index integer NOT NULL,
    input_node_id text NOT NULL,
    CONSTRAINT image_node_inputs_input_index_check CHECK ((input_index >= 0)),
    CONSTRAINT image_node_inputs_not_self_check CHECK ((node_id <> input_node_id))
);


ALTER TABLE public.image_node_inputs OWNER TO postgres;

--
-- Name: image_nodes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.image_nodes (
    photo_id uuid NOT NULL,
    id text NOT NULL,
    kind text NOT NULL,
    recipe_version integer NOT NULL,
    parameters jsonb NOT NULL,
    recipe_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT image_nodes_id_check CHECK ((id ~ '^node_[0-9a-f]{64}$'::text)),
    CONSTRAINT image_nodes_kind_check CHECK ((kind = ANY (ARRAY['source'::text, 'develop'::text, 'generate'::text, 'upscale'::text, 'resample'::text, 'transform'::text, 'solid'::text, 'mask'::text, 'delta'::text, 'heal'::text, 'mask_composite'::text, 'composite'::text, 'crop'::text, 'markup'::text, 'output'::text]))),
    CONSTRAINT image_nodes_recipe_hash_check CHECK ((recipe_hash ~ '^recipe_[0-9a-f]{64}$'::text)),
    CONSTRAINT image_nodes_recipe_version_check CHECK ((((kind = ANY (ARRAY['composite'::text, 'resample'::text, 'generate'::text])) AND (recipe_version = ANY (ARRAY[1, 2]))) OR ((kind <> ALL (ARRAY['composite'::text, 'resample'::text, 'generate'::text])) AND (recipe_version = 1))))
);


ALTER TABLE public.image_nodes OWNER TO postgres;

--
-- Name: layers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.layers (
    photo_id uuid NOT NULL,
    id uuid NOT NULL,
    role text NOT NULL,
    of_layer uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT layers_role_check CHECK ((role = ANY (ARRAY['subject'::text, 'vacancy'::text, 'reimagine'::text, 'retouch'::text])))
);


ALTER TABLE public.layers OWNER TO postgres;

--
-- Name: markup; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.markup (
    photo_id uuid NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT markup_items_array_check CHECK ((jsonb_typeof(items) = 'array'::text))
);


ALTER TABLE public.markup OWNER TO postgres;

--
-- Name: node_execution_inputs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.node_execution_inputs (
    photo_id uuid NOT NULL,
    execution_id text NOT NULL,
    input_index integer NOT NULL,
    input_artifact_hash text NOT NULL,
    CONSTRAINT node_execution_inputs_index_check CHECK ((input_index >= 0))
);


ALTER TABLE public.node_execution_inputs OWNER TO postgres;

--
-- Name: node_executions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.node_executions (
    photo_id uuid NOT NULL,
    execution_id text NOT NULL,
    node_id text NOT NULL,
    evaluation_hash text NOT NULL,
    deterministic boolean NOT NULL,
    output_artifact_hash text NOT NULL,
    source_locator jsonb,
    source_tier text,
    source_w integer,
    source_h integer,
    decoder_id text,
    decoder_version text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    provider_execution jsonb,
    CONSTRAINT node_executions_evaluation_hash_check CHECK ((evaluation_hash ~ '^eval_[0-9a-f]{64}$'::text)),
    CONSTRAINT node_executions_id_check CHECK ((execution_id ~ '^exec_[0-9a-f]{64}$'::text)),
    CONSTRAINT node_executions_provider_execution_check CHECK (((provider_execution IS NULL) OR (jsonb_typeof(provider_execution) = 'object'::text))),
    CONSTRAINT node_executions_source_h_check CHECK ((source_h > 0)),
    CONSTRAINT node_executions_source_provenance_check CHECK ((((source_locator IS NULL) AND (source_tier IS NULL) AND (source_w IS NULL) AND (source_h IS NULL) AND (decoder_id IS NULL) AND (decoder_version IS NULL)) OR ((source_locator IS NOT NULL) AND (source_tier IS NOT NULL) AND (source_w IS NOT NULL) AND (source_h IS NOT NULL) AND (decoder_id IS NOT NULL) AND (decoder_version IS NOT NULL)))),
    CONSTRAINT node_executions_source_w_check CHECK ((source_w > 0))
);


ALTER TABLE public.node_executions OWNER TO postgres;

--
-- Name: photo_documents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.photo_documents (
    photo_id uuid NOT NULL,
    active_revision_id uuid
);


ALTER TABLE public.photo_documents OWNER TO postgres;

--
-- Name: photos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.photos (
    id uuid NOT NULL,
    content_key text NOT NULL,
    content_hash text,
    size bigint NOT NULL,
    w integer NOT NULL,
    h integer NOT NULL,
    orientation integer NOT NULL,
    camera jsonb DEFAULT '{}'::jsonb NOT NULL,
    exposure jsonb DEFAULT '{}'::jsonb NOT NULL,
    shot_at timestamp with time zone,
    shot_offset_min integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    rating integer DEFAULT 0 NOT NULL,
    flag text DEFAULT 'none'::text NOT NULL,
    label text,
    search_text text DEFAULT ''::text NOT NULL,
    searchable tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, search_text)) STORED,
    CONSTRAINT photos_flag_check CHECK ((flag = ANY (ARRAY['pick'::text, 'reject'::text, 'none'::text]))),
    CONSTRAINT photos_h_check CHECK ((h > 0)),
    CONSTRAINT photos_label_check CHECK ((label = ANY (ARRAY['red'::text, 'yellow'::text, 'green'::text, 'blue'::text, 'purple'::text]))),
    CONSTRAINT photos_orientation_check CHECK (((orientation >= 1) AND (orientation <= 8))),
    CONSTRAINT photos_rating_check CHECK (((rating >= 0) AND (rating <= 5))),
    CONSTRAINT photos_shot_offset_min_check CHECK (((shot_offset_min >= '-840'::integer) AND (shot_offset_min <= 840))),
    CONSTRAINT photos_size_check CHECK ((size >= 0)),
    CONSTRAINT photos_w_check CHECK ((w > 0))
);


ALTER TABLE public.photos OWNER TO postgres;

--
-- Name: schema_version; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.schema_version (
    version integer NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.schema_version OWNER TO postgres;

--
-- Name: settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.settings (
    key text NOT NULL,
    value jsonb NOT NULL
);


ALTER TABLE public.settings OWNER TO postgres;

--
-- Name: tags; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tags (
    photo_id uuid NOT NULL,
    tag text NOT NULL,
    CONSTRAINT tags_tag_check CHECK ((length(tag) > 0))
);


ALTER TABLE public.tags OWNER TO postgres;

--
-- Name: volumes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.volumes (
    uuid text NOT NULL,
    label text,
    last_mount text NOT NULL,
    last_seen timestamp with time zone NOT NULL
);


ALTER TABLE public.volumes OWNER TO postgres;

--
-- Name: xmp_state; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.xmp_state (
    photo_id uuid NOT NULL,
    sidecar_path text NOT NULL,
    read_at timestamp with time zone NOT NULL,
    sidecar_mtime timestamp with time zone NOT NULL
);


ALTER TABLE public.xmp_state OWNER TO postgres;

--
-- Data for Name: cache_index; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.cache_index VALUES ('emb/0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001.jpg', 466017, '2023-10-02 23:18:37+07', true);


--
-- Data for Name: document_revision_layers; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: document_revision_roots; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.document_revision_roots VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c003', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', 'output', 'node_1111111111111111111111111111111111111111111111111111111111111111');
INSERT INTO public.document_revision_roots VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c003', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', 'base', 'node_1111111111111111111111111111111111111111111111111111111111111111');


--
-- Data for Name: document_revisions; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.document_revisions VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c003', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', NULL, true, '2026-09-05 21:22:49.735+07', '{"provider_execution": {"operation": "auto-enhance"}, "develop_before_auto": {"contrast": 9}, "auto_enhance_version": 1}');


--
-- Data for Name: embeddings; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: exports; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.exports OVERRIDING SYSTEM VALUE VALUES (1, '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', '/delivery/a7c2.jpg', '2023-10-02 23:30:00+07', 'r_3333333333333333333333333333333333333333333333333333333333333333', 6730200);


--
-- Data for Name: files; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.files VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c002', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', '6A1F-0C3B', 'a7c2.ARW', '2023-10-02 23:18:37+07', '[{"width": 160, "height": 120, "length": 8217, "offset": 44146}, {"width": 1616, "height": 1080, "length": 466017, "offset": 192674}, {"width": 7008, "height": 4672, "length": 6730200, "offset": 659456}]');


--
-- Data for Name: image_artifacts; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: image_node_inputs; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: image_nodes; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.image_nodes VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', 'node_1111111111111111111111111111111111111111111111111111111111111111', 'source', 1, '{"orientation": 1}', 'recipe_2222222222222222222222222222222222222222222222222222222222222222', '2026-09-05 21:22:49.735+07');


--
-- Data for Name: layers; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: markup; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.markup VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', '[{"id": "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c171", "bbox": [30, 20, 50, 40], "type": "rect", "color": "#ff0000", "width": 3}]');


--
-- Data for Name: node_execution_inputs; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: node_executions; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: photo_documents; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.photo_documents VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c003');


--
-- Data for Name: photos; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.photos VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', 'ck_3dac5c943a33dcc4', 'sha256_3dac5c943a33dcc4', 73400320, 7008, 4672, 1, '{"make": "SONY", "model": "ILCE-7CM2"}', '{}', '2023-10-02 23:18:37+07', 120, '2026-09-05 21:22:49.735+07', 5, 'pick', 'green', 'a7c2 ARW ceremony', DEFAULT);


--
-- Data for Name: schema_version; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.schema_version VALUES (1, '2026-09-05 21:22:49.735+07');
INSERT INTO public.schema_version VALUES (2, '2026-09-05 21:22:49.735+07');
INSERT INTO public.schema_version VALUES (3, '2026-09-05 21:22:49.735+07');
INSERT INTO public.schema_version VALUES (4, '2026-09-05 21:22:49.735+07');
INSERT INTO public.schema_version VALUES (5, '2026-09-05 21:22:49.735+07');
INSERT INTO public.schema_version VALUES (6, '2026-09-05 21:22:49.735+07');
INSERT INTO public.schema_version VALUES (7, '2026-09-05 21:22:49.735+07');
INSERT INTO public.schema_version VALUES (8, '2026-09-05 21:22:49.735+07');
INSERT INTO public.schema_version VALUES (9, '2026-09-05 21:22:49.735+07');
INSERT INTO public.schema_version VALUES (10, '2026-09-05 21:22:49.735+07');
INSERT INTO public.schema_version VALUES (11, '2026-09-05 21:22:49.735+07');
INSERT INTO public.schema_version VALUES (12, '2026-09-05 21:22:49.735+07');
INSERT INTO public.schema_version VALUES (13, '2026-09-05 21:22:49.735+07');
INSERT INTO public.schema_version VALUES (14, '2026-09-05 21:22:49.77+07');
INSERT INTO public.schema_version VALUES (15, '2026-09-05 21:22:49.771+07');


--
-- Data for Name: settings; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.settings VALUES ('library_id', '"0199a7c2-0000-7000-8000-000000000001"');
INSERT INTO public.settings VALUES ('cache_max_bytes', '21474836480');
INSERT INTO public.settings VALUES ('daemon_idle_ms', '900000');
INSERT INTO public.settings VALUES ('daemon_queue_max', '8');
INSERT INTO public.settings VALUES ('embed_mode', '"manual"');


--
-- Data for Name: tags; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.tags VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', 'ceremony');


--
-- Data for Name: volumes; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.volumes VALUES ('6A1F-0C3B', 'A7C2', '/Volumes/A7C2', '2023-10-02 23:18:37+07');


--
-- Data for Name: xmp_state; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.xmp_state VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', '/Volumes/A7C2/a7c2.xmp', '2023-10-02 23:20:00+07', '2023-10-02 23:18:37+07');


--
-- Name: exports_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.exports_id_seq', 1, true);


--
-- Name: cache_index cache_index_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cache_index
    ADD CONSTRAINT cache_index_pkey PRIMARY KEY (path);


--
-- Name: document_revision_layers document_revision_layers_photo_id_revision_id_z_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.document_revision_layers
    ADD CONSTRAINT document_revision_layers_photo_id_revision_id_z_key UNIQUE (photo_id, revision_id, z);


--
-- Name: document_revision_layers document_revision_layers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.document_revision_layers
    ADD CONSTRAINT document_revision_layers_pkey PRIMARY KEY (photo_id, revision_id, layer_id);


--
-- Name: document_revision_roots document_revision_roots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.document_revision_roots
    ADD CONSTRAINT document_revision_roots_pkey PRIMARY KEY (photo_id, revision_id, root_name);


--
-- Name: document_revisions document_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.document_revisions
    ADD CONSTRAINT document_revisions_pkey PRIMARY KEY (photo_id, id);


--
-- Name: embeddings embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.embeddings
    ADD CONSTRAINT embeddings_pkey PRIMARY KEY (photo_id);


--
-- Name: exports exports_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exports
    ADD CONSTRAINT exports_pkey PRIMARY KEY (id);


--
-- Name: files files_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_pkey PRIMARY KEY (id);


--
-- Name: files files_volume_uuid_rel_path_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_volume_uuid_rel_path_key UNIQUE (volume_uuid, rel_path);


--
-- Name: image_artifacts image_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.image_artifacts
    ADD CONSTRAINT image_artifacts_pkey PRIMARY KEY (artifact_hash);


--
-- Name: image_node_inputs image_node_inputs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.image_node_inputs
    ADD CONSTRAINT image_node_inputs_pkey PRIMARY KEY (photo_id, node_id, input_index);


--
-- Name: image_nodes image_nodes_photo_id_recipe_hash_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.image_nodes
    ADD CONSTRAINT image_nodes_photo_id_recipe_hash_key UNIQUE (photo_id, recipe_hash);


--
-- Name: image_nodes image_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.image_nodes
    ADD CONSTRAINT image_nodes_pkey PRIMARY KEY (photo_id, id);


--
-- Name: layers layers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.layers
    ADD CONSTRAINT layers_pkey PRIMARY KEY (photo_id, id);


--
-- Name: markup markup_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.markup
    ADD CONSTRAINT markup_pkey PRIMARY KEY (photo_id);


--
-- Name: node_execution_inputs node_execution_inputs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.node_execution_inputs
    ADD CONSTRAINT node_execution_inputs_pkey PRIMARY KEY (photo_id, execution_id, input_index);


--
-- Name: node_executions node_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.node_executions
    ADD CONSTRAINT node_executions_pkey PRIMARY KEY (photo_id, execution_id);


--
-- Name: photo_documents photo_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.photo_documents
    ADD CONSTRAINT photo_documents_pkey PRIMARY KEY (photo_id);


--
-- Name: photos photos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_pkey PRIMARY KEY (id);


--
-- Name: schema_version schema_version_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schema_version
    ADD CONSTRAINT schema_version_pkey PRIMARY KEY (version);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (photo_id, tag);


--
-- Name: volumes volumes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.volumes
    ADD CONSTRAINT volumes_pkey PRIMARY KEY (uuid);


--
-- Name: xmp_state xmp_state_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.xmp_state
    ADD CONSTRAINT xmp_state_pkey PRIMARY KEY (photo_id);


--
-- Name: document_revision_roots_revision_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX document_revision_roots_revision_idx ON public.document_revision_roots USING btree (revision_id);


--
-- Name: document_revisions_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX document_revisions_id_idx ON public.document_revisions USING btree (id);


--
-- Name: document_revisions_photo_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX document_revisions_photo_created_idx ON public.document_revisions USING btree (photo_id, created_at);


--
-- Name: embeddings_vec_hnsw_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX embeddings_vec_hnsw_idx ON public.embeddings USING hnsw (vec public.halfvec_cosine_ops);


--
-- Name: exports_photo_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX exports_photo_at_idx ON public.exports USING btree (photo_id, at DESC, id DESC);


--
-- Name: files_photo_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX files_photo_id_idx ON public.files USING btree (photo_id);


--
-- Name: image_node_inputs_input_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX image_node_inputs_input_idx ON public.image_node_inputs USING btree (photo_id, input_node_id);


--
-- Name: image_nodes_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX image_nodes_id_idx ON public.image_nodes USING btree (id);


--
-- Name: layers_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX layers_id_idx ON public.layers USING btree (id);


--
-- Name: layers_one_vacancy_per_subject_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX layers_one_vacancy_per_subject_idx ON public.layers USING btree (photo_id, of_layer) WHERE (role = 'vacancy'::text);


--
-- Name: node_executions_deterministic_eval_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX node_executions_deterministic_eval_idx ON public.node_executions USING btree (photo_id, node_id, evaluation_hash) WHERE deterministic;


--
-- Name: node_executions_node_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX node_executions_node_id_idx ON public.node_executions USING btree (photo_id, node_id);


--
-- Name: photos_flag_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX photos_flag_idx ON public.photos USING btree (flag);


--
-- Name: photos_label_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX photos_label_idx ON public.photos USING btree (label);


--
-- Name: photos_promoted_content_hash_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX photos_promoted_content_hash_idx ON public.photos USING btree (content_key, content_hash) WHERE (content_hash IS NOT NULL);


--
-- Name: photos_rating_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX photos_rating_idx ON public.photos USING btree (rating);


--
-- Name: photos_searchable_gin_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX photos_searchable_gin_idx ON public.photos USING gin (searchable);


--
-- Name: photos_shot_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX photos_shot_id_idx ON public.photos USING btree (shot_at, id);


--
-- Name: photos_unpromoted_content_key_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX photos_unpromoted_content_key_idx ON public.photos USING btree (content_key) WHERE (content_hash IS NULL);


--
-- Name: files files_refresh_search_text; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER files_refresh_search_text AFTER INSERT OR DELETE OR UPDATE ON public.files FOR EACH ROW EXECUTE FUNCTION public.refresh_file_search_text();


--
-- Name: tags tags_refresh_search_text; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tags_refresh_search_text AFTER INSERT OR DELETE OR UPDATE ON public.tags FOR EACH ROW EXECUTE FUNCTION public.refresh_tag_search_text();


--
-- Name: document_revision_layers document_revision_layers_photo_id_content_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.document_revision_layers
    ADD CONSTRAINT document_revision_layers_photo_id_content_node_id_fkey FOREIGN KEY (photo_id, content_node_id) REFERENCES public.image_nodes(photo_id, id);


--
-- Name: document_revision_layers document_revision_layers_photo_id_layer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.document_revision_layers
    ADD CONSTRAINT document_revision_layers_photo_id_layer_id_fkey FOREIGN KEY (photo_id, layer_id) REFERENCES public.layers(photo_id, id);


--
-- Name: document_revision_layers document_revision_layers_photo_id_mask_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.document_revision_layers
    ADD CONSTRAINT document_revision_layers_photo_id_mask_node_id_fkey FOREIGN KEY (photo_id, mask_node_id) REFERENCES public.image_nodes(photo_id, id);


--
-- Name: document_revision_layers document_revision_layers_photo_id_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.document_revision_layers
    ADD CONSTRAINT document_revision_layers_photo_id_revision_id_fkey FOREIGN KEY (photo_id, revision_id) REFERENCES public.document_revisions(photo_id, id) ON DELETE CASCADE;


--
-- Name: document_revision_roots document_revision_roots_photo_id_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.document_revision_roots
    ADD CONSTRAINT document_revision_roots_photo_id_node_id_fkey FOREIGN KEY (photo_id, node_id) REFERENCES public.image_nodes(photo_id, id);


--
-- Name: document_revision_roots document_revision_roots_photo_id_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.document_revision_roots
    ADD CONSTRAINT document_revision_roots_photo_id_revision_id_fkey FOREIGN KEY (photo_id, revision_id) REFERENCES public.document_revisions(photo_id, id) ON DELETE CASCADE;


--
-- Name: document_revisions document_revisions_photo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.document_revisions
    ADD CONSTRAINT document_revisions_photo_id_fkey FOREIGN KEY (photo_id) REFERENCES public.photos(id) ON DELETE CASCADE;


--
-- Name: document_revisions document_revisions_photo_id_parent_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.document_revisions
    ADD CONSTRAINT document_revisions_photo_id_parent_revision_id_fkey FOREIGN KEY (photo_id, parent_revision_id) REFERENCES public.document_revisions(photo_id, id);


--
-- Name: embeddings embeddings_photo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.embeddings
    ADD CONSTRAINT embeddings_photo_id_fkey FOREIGN KEY (photo_id) REFERENCES public.photos(id) ON DELETE CASCADE;


--
-- Name: exports exports_photo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exports
    ADD CONSTRAINT exports_photo_id_fkey FOREIGN KEY (photo_id) REFERENCES public.photos(id) ON DELETE CASCADE;


--
-- Name: files files_photo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_photo_id_fkey FOREIGN KEY (photo_id) REFERENCES public.photos(id) ON DELETE CASCADE;


--
-- Name: files files_volume_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_volume_uuid_fkey FOREIGN KEY (volume_uuid) REFERENCES public.volumes(uuid);


--
-- Name: image_node_inputs image_node_inputs_photo_id_input_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.image_node_inputs
    ADD CONSTRAINT image_node_inputs_photo_id_input_node_id_fkey FOREIGN KEY (photo_id, input_node_id) REFERENCES public.image_nodes(photo_id, id);


--
-- Name: image_node_inputs image_node_inputs_photo_id_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.image_node_inputs
    ADD CONSTRAINT image_node_inputs_photo_id_node_id_fkey FOREIGN KEY (photo_id, node_id) REFERENCES public.image_nodes(photo_id, id) ON DELETE CASCADE;


--
-- Name: image_nodes image_nodes_photo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.image_nodes
    ADD CONSTRAINT image_nodes_photo_id_fkey FOREIGN KEY (photo_id) REFERENCES public.photos(id) ON DELETE CASCADE;


--
-- Name: layers layers_photo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.layers
    ADD CONSTRAINT layers_photo_id_fkey FOREIGN KEY (photo_id) REFERENCES public.photos(id) ON DELETE CASCADE;


--
-- Name: layers layers_photo_id_of_layer_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.layers
    ADD CONSTRAINT layers_photo_id_of_layer_fkey FOREIGN KEY (photo_id, of_layer) REFERENCES public.layers(photo_id, id);


--
-- Name: markup markup_photo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.markup
    ADD CONSTRAINT markup_photo_id_fkey FOREIGN KEY (photo_id) REFERENCES public.photos(id) ON DELETE CASCADE;


--
-- Name: node_execution_inputs node_execution_inputs_input_artifact_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.node_execution_inputs
    ADD CONSTRAINT node_execution_inputs_input_artifact_hash_fkey FOREIGN KEY (input_artifact_hash) REFERENCES public.image_artifacts(artifact_hash);


--
-- Name: node_execution_inputs node_execution_inputs_photo_id_execution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.node_execution_inputs
    ADD CONSTRAINT node_execution_inputs_photo_id_execution_id_fkey FOREIGN KEY (photo_id, execution_id) REFERENCES public.node_executions(photo_id, execution_id) ON DELETE CASCADE;


--
-- Name: node_executions node_executions_output_artifact_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.node_executions
    ADD CONSTRAINT node_executions_output_artifact_hash_fkey FOREIGN KEY (output_artifact_hash) REFERENCES public.image_artifacts(artifact_hash);


--
-- Name: node_executions node_executions_photo_id_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.node_executions
    ADD CONSTRAINT node_executions_photo_id_node_id_fkey FOREIGN KEY (photo_id, node_id) REFERENCES public.image_nodes(photo_id, id) ON DELETE CASCADE;


--
-- Name: photo_documents photo_documents_photo_id_active_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.photo_documents
    ADD CONSTRAINT photo_documents_photo_id_active_revision_id_fkey FOREIGN KEY (photo_id, active_revision_id) REFERENCES public.document_revisions(photo_id, id);


--
-- Name: photo_documents photo_documents_photo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.photo_documents
    ADD CONSTRAINT photo_documents_photo_id_fkey FOREIGN KEY (photo_id) REFERENCES public.photos(id) ON DELETE CASCADE;


--
-- Name: tags tags_photo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_photo_id_fkey FOREIGN KEY (photo_id) REFERENCES public.photos(id) ON DELETE CASCADE;


--
-- Name: xmp_state xmp_state_photo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.xmp_state
    ADD CONSTRAINT xmp_state_photo_id_fkey FOREIGN KEY (photo_id) REFERENCES public.photos(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--
