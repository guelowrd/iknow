//! Prints the export paths of the compiled packages (helps find procedure roots by path).
use std::path::Path;

use integration::helpers::build_project_in_dir;

#[test]
fn print_exports() -> anyhow::Result<()> {
    for dir in ["../contracts/oracle", "../contracts/pot"] {
        let pkg = build_project_in_dir(Path::new(dir), true)?;
        println!("== {dir}");
        for export in pkg.manifest.exports() {
            println!("  {}", export.path());
        }
    }
    Ok(())
}
