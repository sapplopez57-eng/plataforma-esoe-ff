ALTER TABLE estudiantes
    ADD CONSTRAINT estudiante_tipo_sangre_valido
        CHECK (tipo_sangre IS NULL OR tipo_sangre IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    ADD CONSTRAINT estudiante_nacimiento_razonable
        CHECK (fecha_nacimiento >= DATE '1900-01-01'),
    ADD CONSTRAINT estudiante_grado_solo_militar
        CHECK (condicion = 'MILITAR' OR grado IS NULL);

ALTER TABLE catedraticos
    ADD CONSTRAINT catedratico_grado_solo_militar
        CHECK (condicion = 'MILITAR' OR grado IS NULL);
