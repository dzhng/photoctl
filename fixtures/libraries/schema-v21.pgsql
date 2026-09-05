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
      COALESCE((
        SELECT string_agg(regexp_replace(rel_path, '[^[:alnum:]]+', ' ', 'g'), ' ' ORDER BY rel_path)
        FROM files
        WHERE photo_id = target_photo_id
      ), ''),
      COALESCE((
        SELECT string_agg(regexp_replace(tag, '[^[:alnum:]]+', ' ', 'g'), ' ' ORDER BY tag)
        FROM tags
        WHERE photo_id = target_photo_id
      ), '')
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
    CONSTRAINT document_revision_roots_name_check CHECK ((root_name = ANY (ARRAY['base'::text, 'output'::text, 'geometry'::text])))
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
    validation_profile text NOT NULL,
    CONSTRAINT image_artifacts_artifact_hash_check CHECK ((artifact_hash ~ '^a_[0-9a-f]{64}$'::text)),
    CONSTRAINT image_artifacts_bytes_check CHECK ((bytes >= 0)),
    CONSTRAINT image_artifacts_h_check CHECK ((h > 0)),
    CONSTRAINT image_artifacts_validation_profile_check CHECK ((validation_profile = ANY (ARRAY['linear-rgb-tiff'::text, 'mask-tiff'::text, 'encoded-image'::text]))),
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
    CONSTRAINT image_nodes_kind_check CHECK ((kind = ANY (ARRAY['source'::text, 'develop'::text, 'generate'::text, 'upscale'::text, 'resample'::text, 'transform'::text, 'solid'::text, 'mask'::text, 'delta'::text, 'heal'::text, 'mask_composite'::text, 'composite'::text, 'crop'::text, 'markup'::text, 'output'::text, 'geometry'::text]))),
    CONSTRAINT image_nodes_recipe_hash_check CHECK ((recipe_hash ~ '^recipe_[0-9a-f]{64}$'::text)),
    CONSTRAINT image_nodes_recipe_version_check CHECK ((((kind = ANY (ARRAY['generate'::text, 'composite'::text])) AND (recipe_version = ANY (ARRAY[1, 2, 3]))) OR ((kind = ANY (ARRAY['resample'::text, 'mask'::text, 'source'::text, 'transform'::text])) AND (recipe_version = ANY (ARRAY[1, 2]))) OR ((kind <> ALL (ARRAY['composite'::text, 'resample'::text, 'generate'::text, 'mask'::text, 'source'::text, 'transform'::text])) AND (recipe_version = 1))))
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
    authored_checkpoint_node_id text,
    CONSTRAINT layers_role_check CHECK ((role = ANY (ARRAY['subject'::text, 'vacancy'::text, 'reimagine'::text, 'retouch'::text, 'border'::text])))
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
    render_frame jsonb,
    provider_image_attempt_id uuid,
    CONSTRAINT node_executions_evaluation_hash_check CHECK ((evaluation_hash ~ '^eval_[0-9a-f]{64}$'::text)),
    CONSTRAINT node_executions_id_check CHECK ((execution_id ~ '^exec_[0-9a-f]{64}$'::text)),
    CONSTRAINT node_executions_provider_execution_check CHECK (((provider_execution IS NULL) OR (jsonb_typeof(provider_execution) = 'object'::text))),
    CONSTRAINT node_executions_render_frame_check CHECK (((render_frame IS NULL) OR (jsonb_typeof(render_frame) = 'object'::text))),
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
    size bigint NOT NULL,
    w integer NOT NULL,
    h integer NOT NULL,
    orientation integer NOT NULL,
    camera jsonb DEFAULT '{}'::jsonb NOT NULL,
    exposure jsonb DEFAULT '{}'::jsonb NOT NULL,
    shot_at timestamp with time zone,
    shot_offset_min integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    content_hash text,
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
-- Name: provider_image_attempts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.provider_image_attempts (
    id uuid NOT NULL,
    request jsonb NOT NULL,
    provenance jsonb DEFAULT '{"schema": 1, "cost_usd": null, "request_id": null, "transport_attempts": null}'::jsonb NOT NULL,
    original_artifact_hash text,
    state text NOT NULL,
    outcome jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT provider_image_attempts_check CHECK (((state <> ALL (ARRAY['retained'::text, 'committed'::text, 'rejected'::text])) OR (original_artifact_hash IS NOT NULL))),
    CONSTRAINT provider_image_attempts_outcome_check CHECK (((outcome IS NULL) OR (jsonb_typeof(outcome) = 'object'::text))),
    CONSTRAINT provider_image_attempts_provenance_check CHECK ((jsonb_typeof(provenance) = 'object'::text)),
    CONSTRAINT provider_image_attempts_request_check CHECK ((jsonb_typeof(request) = 'object'::text)),
    CONSTRAINT provider_image_attempts_state_check CHECK ((state = ANY (ARRAY['started'::text, 'retained'::text, 'committed'::text, 'rejected'::text, 'failed'::text])))
);


ALTER TABLE public.provider_image_attempts OWNER TO postgres;

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



--
-- Data for Name: document_revision_layers; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.document_revision_layers VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'd76423c7-43d1-48f4-bad1-255ada660fe5', '546df901-9075-4bcb-a9d1-f9a89e5b354c', 'Before', 0, 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594', 'node_fa458204f262aabea97b8ec6be0054b7bede1bf86af193b1f2d0b3aa5cedd5cb', 1, 'normal', false);
INSERT INTO public.document_revision_layers VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', '90702979-03c1-4968-942b-3e06b5048d4f', '546df901-9075-4bcb-a9d1-f9a89e5b354c', 'Before', 0, 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594', 'node_fa458204f262aabea97b8ec6be0054b7bede1bf86af193b1f2d0b3aa5cedd5cb', 1, 'normal', false);
INSERT INTO public.document_revision_layers VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', '37b86fbd-51f7-4a4a-b654-6fcc2b4dcc41', '546df901-9075-4bcb-a9d1-f9a89e5b354c', 'Before', 0, 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594', 'node_fa458204f262aabea97b8ec6be0054b7bede1bf86af193b1f2d0b3aa5cedd5cb', 1, 'normal', false);
INSERT INTO public.document_revision_layers VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', '37b86fbd-51f7-4a4a-b654-6fcc2b4dcc41', '84599113-8ad6-4ffb-9e75-e5cb1381b8e5', 'After', 1, 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594', 'node_fa458204f262aabea97b8ec6be0054b7bede1bf86af193b1f2d0b3aa5cedd5cb', 1, 'normal', false);
INSERT INTO public.document_revision_layers VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'c0ab2c4f-ed38-4ded-95bf-a7d1778ec960', '546df901-9075-4bcb-a9d1-f9a89e5b354c', 'Before', 0, 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594', 'node_fa458204f262aabea97b8ec6be0054b7bede1bf86af193b1f2d0b3aa5cedd5cb', 1, 'normal', false);
INSERT INTO public.document_revision_layers VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'c0ab2c4f-ed38-4ded-95bf-a7d1778ec960', '355a2081-a33d-4f5b-993c-dfff6cc7785f', 'Before copy', 1, 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594', 'node_fa458204f262aabea97b8ec6be0054b7bede1bf86af193b1f2d0b3aa5cedd5cb', 1, 'normal', false);
INSERT INTO public.document_revision_layers VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'c0ab2c4f-ed38-4ded-95bf-a7d1778ec960', '84599113-8ad6-4ffb-9e75-e5cb1381b8e5', 'After', 2, 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594', 'node_fa458204f262aabea97b8ec6be0054b7bede1bf86af193b1f2d0b3aa5cedd5cb', 1, 'normal', false);
INSERT INTO public.document_revision_layers VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'a6893b13-309d-4a7b-9504-db664a95855b', '546df901-9075-4bcb-a9d1-f9a89e5b354c', 'Before', 0, 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594', 'node_fa458204f262aabea97b8ec6be0054b7bede1bf86af193b1f2d0b3aa5cedd5cb', 1, 'normal', false);
INSERT INTO public.document_revision_layers VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'a6893b13-309d-4a7b-9504-db664a95855b', '355a2081-a33d-4f5b-993c-dfff6cc7785f', 'Before copy', 1, 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594', 'node_fa458204f262aabea97b8ec6be0054b7bede1bf86af193b1f2d0b3aa5cedd5cb', 1, 'normal', false);
INSERT INTO public.document_revision_layers VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'a6893b13-309d-4a7b-9504-db664a95855b', '84599113-8ad6-4ffb-9e75-e5cb1381b8e5', 'After', 2, 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594', 'node_fa458204f262aabea97b8ec6be0054b7bede1bf86af193b1f2d0b3aa5cedd5cb', 1, 'normal', false);
INSERT INTO public.document_revision_layers VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'a6893b13-309d-4a7b-9504-db664a95855b', '42e6d056-bbfb-48bf-8090-f201302082cb', 'Outpaint', 3, 'node_12678db240469bdbf44ab38745cbbe58f1cfa857dcb1aab85ba387f0d4796892', 'node_fee82dfc09488196952b23760ac84f358ae27910a9ad949f9a6899bc92148d74', 1, 'normal', true);
INSERT INTO public.document_revision_layers VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', '08bf5004-6bb6-4e4e-9e4f-9c8e98e490f4', '546df901-9075-4bcb-a9d1-f9a89e5b354c', 'Before', 0, 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594', 'node_fa458204f262aabea97b8ec6be0054b7bede1bf86af193b1f2d0b3aa5cedd5cb', 1, 'normal', false);
INSERT INTO public.document_revision_layers VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', '08bf5004-6bb6-4e4e-9e4f-9c8e98e490f4', '355a2081-a33d-4f5b-993c-dfff6cc7785f', 'Before copy', 1, 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594', 'node_fa458204f262aabea97b8ec6be0054b7bede1bf86af193b1f2d0b3aa5cedd5cb', 1, 'normal', false);
INSERT INTO public.document_revision_layers VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', '08bf5004-6bb6-4e4e-9e4f-9c8e98e490f4', '84599113-8ad6-4ffb-9e75-e5cb1381b8e5', 'After', 2, 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594', 'node_fa458204f262aabea97b8ec6be0054b7bede1bf86af193b1f2d0b3aa5cedd5cb', 1, 'normal', false);
INSERT INTO public.document_revision_layers VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', '08bf5004-6bb6-4e4e-9e4f-9c8e98e490f4', '42e6d056-bbfb-48bf-8090-f201302082cb', 'Outpaint', 3, 'node_b77be8af6cf5e821c05fff2b9b3bd6b1e8f1114367e3c940a16df78955cc2993', 'node_43a45aa44b3176696606e5ca69879b8335bfbeeb8bcef08d13f7428e09e32116', 1, 'normal', true);


--
-- Data for Name: document_revision_roots; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.document_revision_roots VALUES ('bcfff910-f570-4965-9baa-22016dcac8a8', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'base', 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594');
INSERT INTO public.document_revision_roots VALUES ('bcfff910-f570-4965-9baa-22016dcac8a8', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'output', 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594');
INSERT INTO public.document_revision_roots VALUES ('d76423c7-43d1-48f4-bad1-255ada660fe5', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'output', 'node_201c5a5d7c81cdcb3dcfb15601904190485d6a659c51b02461b0d19a2fc671c0');
INSERT INTO public.document_revision_roots VALUES ('d76423c7-43d1-48f4-bad1-255ada660fe5', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'base', 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594');
INSERT INTO public.document_revision_roots VALUES ('90702979-03c1-4968-942b-3e06b5048d4f', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'output', 'node_201c5a5d7c81cdcb3dcfb15601904190485d6a659c51b02461b0d19a2fc671c0');
INSERT INTO public.document_revision_roots VALUES ('90702979-03c1-4968-942b-3e06b5048d4f', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'geometry', 'node_848e04925ac95dc0975af1a92b4f783541c810cff16246242369c0342871dcca');
INSERT INTO public.document_revision_roots VALUES ('90702979-03c1-4968-942b-3e06b5048d4f', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'base', 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594');
INSERT INTO public.document_revision_roots VALUES ('37b86fbd-51f7-4a4a-b654-6fcc2b4dcc41', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'geometry', 'node_848e04925ac95dc0975af1a92b4f783541c810cff16246242369c0342871dcca');
INSERT INTO public.document_revision_roots VALUES ('37b86fbd-51f7-4a4a-b654-6fcc2b4dcc41', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'output', 'node_201c5a5d7c81cdcb3dcfb15601904190485d6a659c51b02461b0d19a2fc671c0');
INSERT INTO public.document_revision_roots VALUES ('37b86fbd-51f7-4a4a-b654-6fcc2b4dcc41', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'base', 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594');
INSERT INTO public.document_revision_roots VALUES ('c0ab2c4f-ed38-4ded-95bf-a7d1778ec960', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'geometry', 'node_848e04925ac95dc0975af1a92b4f783541c810cff16246242369c0342871dcca');
INSERT INTO public.document_revision_roots VALUES ('c0ab2c4f-ed38-4ded-95bf-a7d1778ec960', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'output', 'node_201c5a5d7c81cdcb3dcfb15601904190485d6a659c51b02461b0d19a2fc671c0');
INSERT INTO public.document_revision_roots VALUES ('c0ab2c4f-ed38-4ded-95bf-a7d1778ec960', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'base', 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594');
INSERT INTO public.document_revision_roots VALUES ('a6893b13-309d-4a7b-9504-db664a95855b', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'geometry', 'node_57894c37d05f0b89538f5b452c5da36f674fbaacb52f0bd086b70ab53de02784');
INSERT INTO public.document_revision_roots VALUES ('a6893b13-309d-4a7b-9504-db664a95855b', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'output', 'node_62589f58a1675db14724b427d8ff4a4eaae1ab7df58dee2cae50d6a9fa3a2357');
INSERT INTO public.document_revision_roots VALUES ('a6893b13-309d-4a7b-9504-db664a95855b', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'base', 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594');
INSERT INTO public.document_revision_roots VALUES ('08bf5004-6bb6-4e4e-9e4f-9c8e98e490f4', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'geometry', 'node_57894c37d05f0b89538f5b452c5da36f674fbaacb52f0bd086b70ab53de02784');
INSERT INTO public.document_revision_roots VALUES ('08bf5004-6bb6-4e4e-9e4f-9c8e98e490f4', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'output', 'node_f6a842ee04f15047b7d7206cd00ed87fc524258e1771df4b559ac1d306364142');
INSERT INTO public.document_revision_roots VALUES ('08bf5004-6bb6-4e4e-9e4f-9c8e98e490f4', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'base', 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594');


--
-- Data for Name: document_revisions; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.document_revisions VALUES ('bcfff910-f570-4965-9baa-22016dcac8a8', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', NULL, false, '2026-09-06 04:19:59.209+07', NULL);
INSERT INTO public.document_revisions VALUES ('d76423c7-43d1-48f4-bad1-255ada660fe5', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'bcfff910-f570-4965-9baa-22016dcac8a8', false, '2026-09-06 04:19:59.246+07', NULL);
INSERT INTO public.document_revisions VALUES ('90702979-03c1-4968-942b-3e06b5048d4f', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'd76423c7-43d1-48f4-bad1-255ada660fe5', false, '2026-09-06 04:19:59.258+07', NULL);
INSERT INTO public.document_revisions VALUES ('37b86fbd-51f7-4a4a-b654-6fcc2b4dcc41', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', '90702979-03c1-4968-942b-3e06b5048d4f', false, '2026-09-06 04:19:59.269+07', NULL);
INSERT INTO public.document_revisions VALUES ('c0ab2c4f-ed38-4ded-95bf-a7d1778ec960', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', '37b86fbd-51f7-4a4a-b654-6fcc2b4dcc41', false, '2026-09-06 04:19:59.281+07', NULL);
INSERT INTO public.document_revisions VALUES ('a6893b13-309d-4a7b-9504-db664a95855b', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'c0ab2c4f-ed38-4ded-95bf-a7d1778ec960', false, '2026-09-06 04:19:59.432+07', NULL);
INSERT INTO public.document_revisions VALUES ('08bf5004-6bb6-4e4e-9e4f-9c8e98e490f4', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'a6893b13-309d-4a7b-9504-db664a95855b', false, '2026-09-06 04:19:59.46+07', NULL);


--
-- Data for Name: embeddings; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: exports; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: files; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: image_artifacts; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.image_artifacts VALUES ('a_afa9233e6c9c1ce5bd08c7bdc489314c89e92cd33a43e5ad3ab84cf05391a0a7', 'image/vnd.photoctl.mask+tiff', 914, 16, 12, true, '2026-09-06 04:19:59.245+07', 'mask-tiff');
INSERT INTO public.image_artifacts VALUES ('a_909bb56b0cba60d503137c8a5031885863d1df48a4346142066ccd76efddf149', 'image/tiff', 4650, 20, 16, true, '2026-09-06 04:19:59.432+07', 'linear-rgb-tiff');
INSERT INTO public.image_artifacts VALUES ('a_31a9661dad8128e77644ffd8872c4373d4bf99bf3e89525fb4c3acd908a28bd5', 'image/png', 106, 20, 16, true, '2026-09-06 04:19:59.432+07', 'encoded-image');
INSERT INTO public.image_artifacts VALUES ('a_62f5ca889349b5a47d6b26fbdfc4865598a4ab52bb39a6995ba7649a6bd30215', 'image/vnd.photoctl.mask+tiff', 1426, 20, 16, true, '2026-09-06 04:19:59.432+07', 'mask-tiff');


--
-- Data for Name: image_node_inputs; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.image_node_inputs VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594', 0, 'node_400fef71431222c339bae4d13ab4b6813963a3ac1dd3a7b379dec6a2355ecd2f');
INSERT INTO public.image_node_inputs VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_201c5a5d7c81cdcb3dcfb15601904190485d6a659c51b02461b0d19a2fc671c0', 0, 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594');
INSERT INTO public.image_node_inputs VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_848e04925ac95dc0975af1a92b4f783541c810cff16246242369c0342871dcca', 0, 'node_c679c7a082f68ee8d23994cb620e9879ee1d503ea5662a014e11a197deb54460');
INSERT INTO public.image_node_inputs VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_e28b5742c920e42b4794c3506b2901005878a1fbfef3f2b4c11bd585f4add1a0', 0, 'node_c679c7a082f68ee8d23994cb620e9879ee1d503ea5662a014e11a197deb54460');
INSERT INTO public.image_node_inputs VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_57894c37d05f0b89538f5b452c5da36f674fbaacb52f0bd086b70ab53de02784', 0, 'node_e28b5742c920e42b4794c3506b2901005878a1fbfef3f2b4c11bd585f4add1a0');
INSERT INTO public.image_node_inputs VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_12678db240469bdbf44ab38745cbbe58f1cfa857dcb1aab85ba387f0d4796892', 0, 'node_f8f69793e5204710508abd98213ea5fe76709caf5fad3b9854ec600d04d03576');
INSERT INTO public.image_node_inputs VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_fee82dfc09488196952b23760ac84f358ae27910a9ad949f9a6899bc92148d74', 0, 'node_65b6e138b99d9791786f25dc53eb69983b3e8a482d316679a50c677e4903eb4b');
INSERT INTO public.image_node_inputs VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_11b4db06f3606cb019dbb6d6e9586a36ae2de052cc384495fdb255cfbd6f6ed5', 0, 'node_400fef71431222c339bae4d13ab4b6813963a3ac1dd3a7b379dec6a2355ecd2f');
INSERT INTO public.image_node_inputs VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_62589f58a1675db14724b427d8ff4a4eaae1ab7df58dee2cae50d6a9fa3a2357', 0, 'node_11b4db06f3606cb019dbb6d6e9586a36ae2de052cc384495fdb255cfbd6f6ed5');
INSERT INTO public.image_node_inputs VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_62589f58a1675db14724b427d8ff4a4eaae1ab7df58dee2cae50d6a9fa3a2357', 1, 'node_12678db240469bdbf44ab38745cbbe58f1cfa857dcb1aab85ba387f0d4796892');
INSERT INTO public.image_node_inputs VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_62589f58a1675db14724b427d8ff4a4eaae1ab7df58dee2cae50d6a9fa3a2357', 2, 'node_fee82dfc09488196952b23760ac84f358ae27910a9ad949f9a6899bc92148d74');
INSERT INTO public.image_node_inputs VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_b77be8af6cf5e821c05fff2b9b3bd6b1e8f1114367e3c940a16df78955cc2993', 0, 'node_f8f69793e5204710508abd98213ea5fe76709caf5fad3b9854ec600d04d03576');
INSERT INTO public.image_node_inputs VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_43a45aa44b3176696606e5ca69879b8335bfbeeb8bcef08d13f7428e09e32116', 0, 'node_65b6e138b99d9791786f25dc53eb69983b3e8a482d316679a50c677e4903eb4b');
INSERT INTO public.image_node_inputs VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_f6a842ee04f15047b7d7206cd00ed87fc524258e1771df4b559ac1d306364142', 0, 'node_11b4db06f3606cb019dbb6d6e9586a36ae2de052cc384495fdb255cfbd6f6ed5');
INSERT INTO public.image_node_inputs VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_f6a842ee04f15047b7d7206cd00ed87fc524258e1771df4b559ac1d306364142', 1, 'node_b77be8af6cf5e821c05fff2b9b3bd6b1e8f1114367e3c940a16df78955cc2993');
INSERT INTO public.image_node_inputs VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_f6a842ee04f15047b7d7206cd00ed87fc524258e1771df4b559ac1d306364142', 2, 'node_43a45aa44b3176696606e5ca69879b8335bfbeeb8bcef08d13f7428e09e32116');


--
-- Data for Name: image_nodes; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.image_nodes VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_400fef71431222c339bae4d13ab4b6813963a3ac1dd3a7b379dec6a2355ecd2f', 'source', 1, '{"orientation": 1}', 'recipe_81842893f26267bbf6b06dc5ccc91b5e0c70739909524d22edc862cc7591b644', '2026-09-06 04:19:59.209+07');
INSERT INTO public.image_nodes VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_b1adc02b84f14e802ac4832983da04ad23edb5aec0f776402d3a4217484fd594', 'output', 1, '{"format": "display-rgb", "color_space": "srgb"}', 'recipe_a3ca36e9bdf42a8191e77503162a5eaa23ba420a7df542cc099602057078a71a', '2026-09-06 04:19:59.209+07');
INSERT INTO public.image_nodes VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_fa458204f262aabea97b8ec6be0054b7bede1bf86af193b1f2d0b3aa5cedd5cb', 'mask', 1, '{"artifact_hash": "a_afa9233e6c9c1ce5bd08c7bdc489314c89e92cd33a43e5ad3ab84cf05391a0a7"}', 'recipe_fe8b9005b9840863c1837cf7c0a9e1e9ba115b6d55fc13bc9aec251f0f196e5a', '2026-09-06 04:19:59.246+07');
INSERT INTO public.image_nodes VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_201c5a5d7c81cdcb3dcfb15601904190485d6a659c51b02461b0d19a2fc671c0', 'composite', 2, '{"layers": []}', 'recipe_13c2667593822777b571b6b41eeb35b8a8605cc3d92f1687da24a446439e1010', '2026-09-06 04:19:59.246+07');
INSERT INTO public.image_nodes VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_c679c7a082f68ee8d23994cb620e9879ee1d503ea5662a014e11a197deb54460', 'geometry', 1, '{"type": "checkpoint", "geometry": {}, "sequence": 1, "input_frame": {"raster": {"h": 12, "w": 16}, "source": {"h": 12, "w": 16}, "catalog": {"h": 12, "w": 16}, "sourceToRaster": [1, 0, 0, 1, 0, 0]}, "outer_frame": {"raster": {"h": 12, "w": 16}, "source": {"h": 12, "w": 16}, "catalog": {"h": 12, "w": 16}, "sourceToRaster": [1, 0, 0, 1, 0, 0]}, "crop_activation": 0, "aspect_activation": 0, "support_input_count": 0}', 'recipe_e55561f497c8fd1bbce6c7e7b827ae2e4bf6dd08ef913eb8bb0a65f5f1670530', '2026-09-06 04:19:59.258+07');
INSERT INTO public.image_nodes VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_848e04925ac95dc0975af1a92b4f783541c810cff16246242369c0342871dcca', 'geometry', 1, '{"type": "intent", "sequence": 1, "crop_activation": 0, "aspect_activation": 0}', 'recipe_963b65c5d83bfd78e9933dc1c6293d5f6915003943775cb0309d203a47fda8d8', '2026-09-06 04:19:59.258+07');
INSERT INTO public.image_nodes VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_e28b5742c920e42b4794c3506b2901005878a1fbfef3f2b4c11bd585f4add1a0', 'geometry', 1, '{"type": "checkpoint", "geometry": {}, "sequence": 2, "input_frame": {"raster": {"h": 12, "w": 16}, "source": {"h": 12, "w": 16}, "catalog": {"h": 12, "w": 16}, "sourceToRaster": [1, 0, 0, 1, 0, 0]}, "outer_frame": {"raster": {"h": 16, "w": 20}, "source": {"h": 12, "w": 16}, "catalog": {"h": 12, "w": 16}, "sourceToRaster": [1, 0, 0, 1, 2, 2]}, "crop_activation": 0, "aspect_activation": 0, "support_input_count": 0}', 'recipe_f9a1df6ef77fcef0bd640c2b478f1123cd86c797ce50e8f1a67f7097e04bb6a1', '2026-09-06 04:19:59.432+07');
INSERT INTO public.image_nodes VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_57894c37d05f0b89538f5b452c5da36f674fbaacb52f0bd086b70ab53de02784', 'geometry', 1, '{"type": "intent", "sequence": 2, "crop_activation": 0, "aspect_activation": 0}', 'recipe_13e3ef7baef93affb863323c9badb9762ff9beeea96ba8ced10a82a4421bf3c1', '2026-09-06 04:19:59.432+07');
INSERT INTO public.image_nodes VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_f8f69793e5204710508abd98213ea5fe76709caf5fad3b9854ec600d04d03576', 'source', 2, '{"artifact_hash": "a_909bb56b0cba60d503137c8a5031885863d1df48a4346142066ccd76efddf149", "encoded_artifact_hash": "a_31a9661dad8128e77644ffd8872c4373d4bf99bf3e89525fb4c3acd908a28bd5"}', 'recipe_a73aeabcebb99ce91a3cc5b9f397222820541aea8668443a370b022d8af4f704', '2026-09-06 04:19:59.432+07');
INSERT INTO public.image_nodes VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_12678db240469bdbf44ab38745cbbe58f1cfa857dcb1aab85ba387f0d4796892', 'transform', 2, '{"frame": {"raster": {"h": 16, "w": 20}, "source": {"h": 12, "w": 16}, "catalog": {"h": 12, "w": 16}, "sourceToRaster": [1, 0, 0, 1, 2, 2]}, "matrix": [1, 0, 0, 1, 0, 0]}', 'recipe_307ee65eff30b2dacbfd462d81a553e1b579c9c007a83afd0837bb22e9f3a0e5', '2026-09-06 04:19:59.432+07');
INSERT INTO public.image_nodes VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_65b6e138b99d9791786f25dc53eb69983b3e8a482d316679a50c677e4903eb4b', 'mask', 1, '{"artifact_hash": "a_62f5ca889349b5a47d6b26fbdfc4865598a4ab52bb39a6995ba7649a6bd30215"}', 'recipe_67ebeb8933bdb5545e64468035df2fa7eed1c321b9a79990e5ccb5f77e14482b', '2026-09-06 04:19:59.432+07');
INSERT INTO public.image_nodes VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_fee82dfc09488196952b23760ac84f358ae27910a9ad949f9a6899bc92148d74', 'transform', 2, '{"frame": {"raster": {"h": 16, "w": 20}, "source": {"h": 12, "w": 16}, "catalog": {"h": 12, "w": 16}, "sourceToRaster": [1, 0, 0, 1, 2, 2]}, "matrix": [1, 0, 0, 1, 0, 0]}', 'recipe_025c1f6bafb610c37c7be8bb237713aa6248626894abe231bd8b038c28eeff8f', '2026-09-06 04:19:59.432+07');
INSERT INTO public.image_nodes VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_11b4db06f3606cb019dbb6d6e9586a36ae2de052cc384495fdb255cfbd6f6ed5', 'develop', 1, '{}', 'recipe_440b6d822d988359303fe463f0de3df145776abab5cea7ac0a3a3975bbbaf68f', '2026-09-06 04:19:59.432+07');
INSERT INTO public.image_nodes VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_62589f58a1675db14724b427d8ff4a4eaae1ab7df58dee2cae50d6a9fa3a2357', 'composite', 3, '{"frame": {"raster": {"h": 16, "w": 20}, "source": {"h": 12, "w": 16}, "catalog": {"h": 12, "w": 16}, "sourceToRaster": [1, 0, 0, 1, 2, 2]}, "layers": [{"blend": "normal", "frame": {"raster": {"h": 16, "w": 20}, "source": {"h": 16, "w": 20}, "catalog": {"h": 12, "w": 16}, "sourceToRaster": [0.8, 0, 0, 0.75, 2, 2]}, "stages": [{"raster": {"h": 16, "w": 20}, "source": {"h": 12, "w": 16}, "catalog": {"h": 12, "w": 16}, "sourceToRaster": [1, 0, 0, 1, 2, 2]}], "opacity": 1}], "uncovered": false, "base_stages": [{"raster": {"h": 12, "w": 16}, "source": {"h": 12, "w": 16}, "catalog": {"h": 12, "w": 16}, "sourceToRaster": [1, 0, 0, 1, 0, 0]}, {"raster": {"h": 12, "w": 16}, "source": {"h": 12, "w": 16}, "catalog": {"h": 12, "w": 16}, "sourceToRaster": [1, 0, 0, 1, 0, 0]}, {"raster": {"h": 16, "w": 20}, "source": {"h": 12, "w": 16}, "catalog": {"h": 12, "w": 16}, "sourceToRaster": [1, 0, 0, 1, 2, 2]}]}', 'recipe_0445af05636b9d7d3563b1f126b947c3251d202425980e5c242518a7ca598da9', '2026-09-06 04:19:59.432+07');
INSERT INTO public.image_nodes VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_b77be8af6cf5e821c05fff2b9b3bd6b1e8f1114367e3c940a16df78955cc2993', 'transform', 2, '{"frame": {"raster": {"h": 16, "w": 20}, "source": {"h": 12, "w": 16}, "catalog": {"h": 12, "w": 16}, "sourceToRaster": [1, 0, 0, 1, -2, 2]}, "matrix": [1, 0, 0, 1, 4, 0]}', 'recipe_e628e0c70c8faf3334f236796192970de4bdc1050d46a9790b979e17e172e6db', '2026-09-06 04:19:59.46+07');
INSERT INTO public.image_nodes VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_43a45aa44b3176696606e5ca69879b8335bfbeeb8bcef08d13f7428e09e32116', 'transform', 2, '{"frame": {"raster": {"h": 16, "w": 20}, "source": {"h": 12, "w": 16}, "catalog": {"h": 12, "w": 16}, "sourceToRaster": [1, 0, 0, 1, -2, 2]}, "matrix": [1, 0, 0, 1, 4, 0]}', 'recipe_c1d2cb4a010578f0ed8e38dbe0a36880fc5a880b1d77782d25a1620e8aced045', '2026-09-06 04:19:59.46+07');
INSERT INTO public.image_nodes VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'node_f6a842ee04f15047b7d7206cd00ed87fc524258e1771df4b559ac1d306364142', 'composite', 3, '{"frame": {"raster": {"h": 16, "w": 22}, "source": {"h": 12, "w": 16}, "catalog": {"h": 12, "w": 16}, "sourceToRaster": [1, 0, 0, 1, 0, 2]}, "layers": [{"blend": "normal", "frame": {"raster": {"h": 16, "w": 20}, "source": {"h": 16, "w": 20}, "catalog": {"h": 12, "w": 16}, "sourceToRaster": [0.8, 0, 0, 0.75, -2, 2]}, "stages": [{"raster": {"h": 16, "w": 22}, "source": {"h": 12, "w": 16}, "catalog": {"h": 12, "w": 16}, "sourceToRaster": [1, 0, 0, 1, 0, 2]}], "opacity": 1}], "uncovered": true, "base_stages": [{"raster": {"h": 12, "w": 16}, "source": {"h": 12, "w": 16}, "catalog": {"h": 12, "w": 16}, "sourceToRaster": [1, 0, 0, 1, 0, 0]}, {"raster": {"h": 12, "w": 16}, "source": {"h": 12, "w": 16}, "catalog": {"h": 12, "w": 16}, "sourceToRaster": [1, 0, 0, 1, 0, 0]}, {"raster": {"h": 16, "w": 22}, "source": {"h": 12, "w": 16}, "catalog": {"h": 12, "w": 16}, "sourceToRaster": [1, 0, 0, 1, 0, 2]}]}', 'recipe_bad144c901ae424cb3c5a73be466ed2e064a54a6a1bffe344d300e25a88a1200', '2026-09-06 04:19:59.46+07');


--
-- Data for Name: layers; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.layers VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', '546df901-9075-4bcb-a9d1-f9a89e5b354c', 'subject', NULL, '2026-09-06 04:19:59.246+07', NULL);
INSERT INTO public.layers VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', '84599113-8ad6-4ffb-9e75-e5cb1381b8e5', 'subject', NULL, '2026-09-06 04:19:59.269+07', 'node_c679c7a082f68ee8d23994cb620e9879ee1d503ea5662a014e11a197deb54460');
INSERT INTO public.layers VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', '355a2081-a33d-4f5b-993c-dfff6cc7785f', 'subject', NULL, '2026-09-06 04:19:59.281+07', NULL);
INSERT INTO public.layers VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', '42e6d056-bbfb-48bf-8090-f201302082cb', 'border', NULL, '2026-09-06 04:19:59.432+07', 'node_e28b5742c920e42b4794c3506b2901005878a1fbfef3f2b4c11bd585f4add1a0');


--
-- Data for Name: markup; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: node_execution_inputs; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: node_executions; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: photo_documents; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.photo_documents VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', '08bf5004-6bb6-4e4e-9e4f-9c8e98e490f4');


--
-- Data for Name: photos; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.photos VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c191', 'ck_canvas_fixture_19', 1, 16, 12, 1, '{}', '{}', NULL, NULL, '2026-09-06 04:19:59.207+07', NULL, 0, 'none', NULL, '', DEFAULT);


--
-- Data for Name: provider_image_attempts; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: schema_version; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.schema_version VALUES (1, '2026-09-06 04:19:59.167+07');
INSERT INTO public.schema_version VALUES (2, '2026-09-06 04:19:59.171+07');
INSERT INTO public.schema_version VALUES (3, '2026-09-06 04:19:59.173+07');
INSERT INTO public.schema_version VALUES (4, '2026-09-06 04:19:59.177+07');
INSERT INTO public.schema_version VALUES (5, '2026-09-06 04:19:59.185+07');
INSERT INTO public.schema_version VALUES (6, '2026-09-06 04:19:59.187+07');
INSERT INTO public.schema_version VALUES (7, '2026-09-06 04:19:59.188+07');
INSERT INTO public.schema_version VALUES (8, '2026-09-06 04:19:59.194+07');
INSERT INTO public.schema_version VALUES (9, '2026-09-06 04:19:59.198+07');
INSERT INTO public.schema_version VALUES (10, '2026-09-06 04:19:59.199+07');
INSERT INTO public.schema_version VALUES (11, '2026-09-06 04:19:59.2+07');
INSERT INTO public.schema_version VALUES (12, '2026-09-06 04:19:59.201+07');
INSERT INTO public.schema_version VALUES (13, '2026-09-06 04:19:59.201+07');
INSERT INTO public.schema_version VALUES (14, '2026-09-06 04:19:59.202+07');
INSERT INTO public.schema_version VALUES (15, '2026-09-06 04:19:59.203+07');
INSERT INTO public.schema_version VALUES (16, '2026-09-06 04:19:59.204+07');
INSERT INTO public.schema_version VALUES (17, '2026-09-06 04:19:59.204+07');
INSERT INTO public.schema_version VALUES (18, '2026-09-06 04:19:59.205+07');
INSERT INTO public.schema_version VALUES (19, '2026-09-06 04:19:59.207+07');
INSERT INTO public.schema_version VALUES (20, '2026-09-06 04:19:59.358+07');
INSERT INTO public.schema_version VALUES (21, '2026-09-06 04:19:59.36+07');


--
-- Data for Name: settings; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.settings VALUES ('daemon_queue_max', '8');
INSERT INTO public.settings VALUES ('embed_mode', '"manual"');
INSERT INTO public.settings VALUES ('library_id', '"0199a7c2-0000-7000-8000-000000000019"');


--
-- Data for Name: tags; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: volumes; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: xmp_state; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Name: exports_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.exports_id_seq', 1, false);


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
-- Name: provider_image_attempts provider_image_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.provider_image_attempts
    ADD CONSTRAINT provider_image_attempts_pkey PRIMARY KEY (id);


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
-- Name: node_executions_provider_image_attempt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX node_executions_provider_image_attempt_idx ON public.node_executions USING btree (provider_image_attempt_id) WHERE (provider_image_attempt_id IS NOT NULL);


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
-- Name: provider_image_attempts_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX provider_image_attempts_created_idx ON public.provider_image_attempts USING btree (created_at DESC, id DESC);


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
-- Name: layers layers_photo_id_authored_checkpoint_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.layers
    ADD CONSTRAINT layers_photo_id_authored_checkpoint_node_id_fkey FOREIGN KEY (photo_id, authored_checkpoint_node_id) REFERENCES public.image_nodes(photo_id, id);


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
-- Name: node_executions node_executions_provider_image_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.node_executions
    ADD CONSTRAINT node_executions_provider_image_attempt_id_fkey FOREIGN KEY (provider_image_attempt_id) REFERENCES public.provider_image_attempts(id);


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
-- Name: provider_image_attempts provider_image_attempts_original_artifact_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.provider_image_attempts
    ADD CONSTRAINT provider_image_attempts_original_artifact_hash_fkey FOREIGN KEY (original_artifact_hash) REFERENCES public.image_artifacts(artifact_hash);


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
