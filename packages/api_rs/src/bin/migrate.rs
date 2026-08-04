fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    dotenvy::dotenv().ok();
    let database = catlas_api::config::DatabaseConfig::from_env()?;
    catlas_api::database::connect_and_migrate(database.url().to_owned())?;
    Ok(())
}
