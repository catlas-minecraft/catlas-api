fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    dotenvy::dotenv().ok();
    let database_url = std::env::var("DATABASE_URL")?;
    catlas_api::database::connect_and_migrate(database_url)?;
    Ok(())
}
