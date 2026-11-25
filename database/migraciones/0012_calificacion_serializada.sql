CREATE OR REPLACE FUNCTION exigir_nota_dentro_del_puntaje() RETURNS trigger AS $$
DECLARE
    tope NUMERIC(5,2);
BEGIN
    IF NEW.nota IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT puntaje_maximo INTO tope FROM tareas WHERE id = NEW.tarea_id FOR UPDATE;
    IF tope IS NOT NULL AND NEW.nota > tope THEN
        RAISE EXCEPTION 'La nota % pasa del puntaje maximo % de la tarea.', NEW.nota, tope
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
