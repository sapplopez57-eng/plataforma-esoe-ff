-- =============================================================================
-- PLATAFORMA ESOE - SCHOOL MANAGEMENT SYSTEM (SMS)
-- Esquema de Base de Datos Relacional (PostgreSQL)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tipos Enumerados
CREATE TYPE modalidad_periodo AS ENUM ('SEMESTRAL', 'CUATRIMESTRAL', 'MODULAR', 'ANUAL');
CREATE TYPE condicion_personal AS ENUM ('MILITAR', 'CIVIL');
CREATE TYPE rol_usuario AS ENUM ('ADMIN', 'CATEDRATICO', 'ESTUDIANTE');
CREATE TYPE estado_estudiante AS ENUM ('ACTIVO', 'BAJA', 'EGRESADO', 'PERMISO_ESPECIAL');
CREATE TYPE estado_asistencia AS ENUM ('PRESENTE', 'AUSENTE', 'TARDANZA', 'EXCUSA');

-- 2. Usuarios y Autenticacion
CREATE TABLE usuarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(60) UNIQUE NOT NULL,
    -- La identidad y la contrasena las gestiona el proveedor de autenticacion.
    proveedor_id VARCHAR(64) UNIQUE NOT NULL,
    rol rol_usuario NOT NULL,
    nombre_completo VARCHAR(150) NOT NULL,
    referencia_id UUID,
    activo BOOLEAN DEFAULT TRUE,
    ultimo_acceso TIMESTAMP WITH TIME ZONE,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Periodos Lectivos (4 modalidades habilitadas)
CREATE TABLE periodos_lectivos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo VARCHAR(30) UNIQUE NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    modalidad modalidad_periodo NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Promociones
CREATE TABLE promociones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo VARCHAR(30) UNIQUE NOT NULL,
    nombre VARCHAR(120) NOT NULL,
    anio_ingreso INTEGER NOT NULL,
    anio_egreso INTEGER NOT NULL,
    descripcion TEXT,
    activa BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Expediente de Estudiantes
CREATE TABLE estudiantes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo_alumno VARCHAR(30) UNIQUE NOT NULL, -- Codigo numerico nivel FFAA
    dni VARCHAR(25) UNIQUE NOT NULL,
    nombres VARCHAR(80) NOT NULL,
    apellidos VARCHAR(80) NOT NULL,
    condicion condicion_personal NOT NULL DEFAULT 'MILITAR',
    grado VARCHAR(60), -- Grado militar en caso de ser militar
    fecha_nacimiento DATE NOT NULL,
    tipo_sangre VARCHAR(5),
    telefono VARCHAR(30),
    correo VARCHAR(120),
    direccion TEXT,
    lugar_procedencia VARCHAR(100),
    contacto_emergencia_nombre VARCHAR(120),
    contacto_emergencia_telefono VARCHAR(30),
    promocion_id UUID NOT NULL REFERENCES promociones(id),
    estado estado_estudiante NOT NULL DEFAULT 'ACTIVO',
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Expediente de Catedraticos
CREATE TABLE catedraticos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dni VARCHAR(25) UNIQUE NOT NULL,
    nombres VARCHAR(80) NOT NULL,
    apellidos VARCHAR(80) NOT NULL,
    titulo VARCHAR(150) NOT NULL,
    condicion condicion_personal NOT NULL DEFAULT 'MILITAR',
    grado VARCHAR(60), -- Grado militar en caso de ser militar
    correo VARCHAR(120),
    telefono VARCHAR(30),
    activo BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Catalogo de Materias
CREATE TABLE materias (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo VARCHAR(20) UNIQUE NOT NULL,
    nombre VARCHAR(120) NOT NULL,
    unidades_valorativas INTEGER NOT NULL DEFAULT 3,
    horas_semanales INTEGER NOT NULL DEFAULT 4,
    descripcion TEXT,
    activa BOOLEAN DEFAULT TRUE
);

-- 9. Carga Academica / Clases
-- Regla de negocio: 1 Catedratico titular por clase (materia + promocion).
-- Un catedratico puede impartir varias clases, pero cada clase tiene solo 1 titular.
CREATE TABLE clases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo_clase VARCHAR(30) UNIQUE NOT NULL,
    periodo_id UUID NOT NULL REFERENCES periodos_lectivos(id),
    promocion_id UUID NOT NULL REFERENCES promociones(id),
    materia_id UUID NOT NULL REFERENCES materias(id),
    catedratico_id UUID NOT NULL REFERENCES catedraticos(id),
    horario VARCHAR(120) NOT NULL,
    aula VARCHAR(50),
    activa BOOLEAN DEFAULT TRUE,
    UNIQUE(periodo_id, promocion_id, materia_id)
);

-- 10. Sesiones de Asistencia (Por Clase)
CREATE TABLE sesiones_asistencia (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clase_id UUID NOT NULL REFERENCES clases(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    tema_impartido VARCHAR(200),
    registrado_por UUID REFERENCES usuarios(id),
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(clase_id, fecha)
);

CREATE TABLE detalle_asistencia (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sesion_id UUID NOT NULL REFERENCES sesiones_asistencia(id) ON DELETE CASCADE,
    estudiante_id UUID NOT NULL REFERENCES estudiantes(id) ON DELETE CASCADE,
    estado estado_asistencia NOT NULL DEFAULT 'PRESENTE',
    observacion VARCHAR(255),
    UNIQUE(sesion_id, estudiante_id)
);

-- 11. Calificaciones (Escala 0% - 100%, Aprobacion >= 70%)
CREATE TABLE calificaciones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clase_id UUID NOT NULL REFERENCES clases(id) ON DELETE CASCADE,
    estudiante_id UUID NOT NULL REFERENCES estudiantes(id) ON DELETE CASCADE,
    parcial_1 NUMERIC(5,2) DEFAULT 0 CHECK (parcial_1 >= 0 AND parcial_1 <= 100),
    parcial_2 NUMERIC(5,2) DEFAULT 0 CHECK (parcial_2 >= 0 AND parcial_2 <= 100),
    parcial_3 NUMERIC(5,2) DEFAULT 0 CHECK (parcial_3 >= 0 AND parcial_3 <= 100),
    acumulativo NUMERIC(5,2) DEFAULT 0 CHECK (acumulativo >= 0 AND acumulativo <= 100),
    nota_final NUMERIC(5,2) GENERATED ALWAYS AS (
        ROUND((parcial_1 * 0.25) + (parcial_2 * 0.25) + (parcial_3 * 0.25) + (acumulativo * 0.25), 2)
    ) STORED,
    aprobado BOOLEAN GENERATED ALWAYS AS (
        ROUND((parcial_1 * 0.25) + (parcial_2 * 0.25) + (parcial_3 * 0.25) + (acumulativo * 0.25), 2) >= 70.00
    ) STORED,
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(clase_id, estudiante_id)
);

-- 12. Conexion con otras plataformas educativas (Moodle, INFOP)
CREATE TYPE tipo_plataforma AS ENUM ('MOODLE');

CREATE TABLE plataformas_externas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre VARCHAR(120) NOT NULL,
    tipo tipo_plataforma NOT NULL,
    url_base VARCHAR(300) UNIQUE NOT NULL,
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    creada_por VARCHAR(64) NOT NULL,
    creada_en TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Cuenta personal de un usuario en una plataforma externa.
-- El token se guarda cifrado; la contrasena nunca se almacena.
CREATE TABLE cuentas_externas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plataforma_id UUID NOT NULL REFERENCES plataformas_externas(id) ON DELETE CASCADE,
    usuario_id VARCHAR(64) NOT NULL,
    token_cifrado TEXT NOT NULL,
    usuario_remoto_id INTEGER NOT NULL,
    nombre_remoto VARCHAR(150),
    vinculada_en TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(plataforma_id, usuario_id)
);
