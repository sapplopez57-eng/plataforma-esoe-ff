CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE modalidad_periodo AS ENUM ('SEMESTRAL', 'CUATRIMESTRAL', 'MODULAR', 'ANUAL');
CREATE TYPE condicion_personal AS ENUM ('MILITAR', 'CIVIL');
CREATE TYPE rol_usuario AS ENUM ('ADMIN', 'CATEDRATICO', 'ESTUDIANTE');
CREATE TYPE estado_estudiante AS ENUM ('ACTIVO', 'BAJA', 'EGRESADO', 'PERMISO_ESPECIAL');
CREATE TYPE estado_asistencia AS ENUM ('PRESENTE', 'AUSENTE', 'TARDANZA', 'EXCUSA');

CREATE TABLE usuarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(60) UNIQUE NOT NULL,
    proveedor_id VARCHAR(64) UNIQUE NOT NULL,
    rol rol_usuario NOT NULL,
    nombre_completo VARCHAR(150) NOT NULL,
    referencia_id UUID,
    activo BOOLEAN DEFAULT TRUE,
    ultimo_acceso TIMESTAMP WITH TIME ZONE,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE estudiantes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo_alumno VARCHAR(30) UNIQUE NOT NULL,
    dni VARCHAR(25) UNIQUE NOT NULL,
    nombres VARCHAR(80) NOT NULL,
    apellidos VARCHAR(80) NOT NULL,
    condicion condicion_personal NOT NULL DEFAULT 'MILITAR',
    grado VARCHAR(60),
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

CREATE TABLE catedraticos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dni VARCHAR(25) UNIQUE NOT NULL,
    nombres VARCHAR(80) NOT NULL,
    apellidos VARCHAR(80) NOT NULL,
    titulo VARCHAR(150) NOT NULL,
    condicion condicion_personal NOT NULL DEFAULT 'MILITAR',
    grado VARCHAR(60),
    correo VARCHAR(120),
    telefono VARCHAR(30),
    activo BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE materias (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo VARCHAR(20) UNIQUE NOT NULL,
    nombre VARCHAR(120) NOT NULL,
    unidades_valorativas INTEGER NOT NULL DEFAULT 3,
    horas_semanales INTEGER NOT NULL DEFAULT 4,
    descripcion TEXT,
    activa BOOLEAN DEFAULT TRUE
);

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
