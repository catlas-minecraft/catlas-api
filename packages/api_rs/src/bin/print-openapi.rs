use catlas_api::openapi_service;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    use std::io::Write;

    std::io::stdout().write_all(openapi_service().spec().as_bytes())?;
    Ok(())
}
