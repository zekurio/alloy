//! GPUs as DRM render nodes. The settings list them as `adapter:{index}:{label}`
//! in render-node order, and the index picks the VAAPI device the encoder
//! opens.

use std::fs;

pub(in crate::agent) struct RenderNode {
    pub(in crate::agent) path: String,
    pub(in crate::agent) label: String,
}

/// PCI ID databases, from hwdata or pciutils.
const PCI_ID_DATABASES: &[&str] = &[
    "/usr/share/hwdata/pci.ids",
    "/usr/share/misc/pci.ids",
    "/usr/share/pci.ids",
    "/run/current-system/sw/share/hwdata/pci.ids",
];

pub(in crate::agent) fn render_nodes() -> Vec<RenderNode> {
    let Ok(entries) = fs::read_dir("/sys/class/drm") else {
        return Vec::new();
    };
    let mut nodes: Vec<(u32, RenderNode)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let number = name.strip_prefix("renderD")?.parse().ok()?;
            let device = entry.path().join("device");
            let vendor = pci_id(&fs::read_to_string(device.join("vendor")).ok()?)?;
            let product = fs::read_to_string(device.join("device"))
                .ok()
                .and_then(|value| pci_id(&value));
            Some((
                number,
                RenderNode {
                    path: format!("/dev/dri/{name}"),
                    label: gpu_label(vendor, product),
                },
            ))
        })
        .collect();
    nodes.sort_by_key(|(number, _)| *number);
    nodes.into_iter().map(|(_, node)| node).collect()
}

/// The render node for an adapter index from the settings.
pub(in crate::agent) fn render_node(adapter: u32) -> Option<String> {
    render_nodes()
        .into_iter()
        .nth(usize::try_from(adapter).ok()?)
        .map(|node| node.path)
}

fn pci_id(value: &str) -> Option<u16> {
    u16::from_str_radix(value.trim().trim_start_matches("0x"), 16).ok()
}

/// The vendor and, when a PCI ID database knows it, the model, for example
/// `Intel DG2 [Arc A380]`. The vendor names match what encoder selection
/// looks for.
fn gpu_label(vendor: u16, product: Option<u16>) -> String {
    let vendor_name = match vendor {
        0x8086 => "Intel",
        0x1002 => "AMD",
        0x10de => "NVIDIA",
        _ => "GPU",
    };
    match product.and_then(|product| pci_device_name(vendor, product)) {
        Some(model) => format!("{vendor_name} {model}"),
        None => format!("{vendor_name} {vendor:04x}:{:04x}", product.unwrap_or(0)),
    }
}

/// Looks the device up in `pci.ids`: a vendor line at column 0, then its
/// devices indented by one tab.
fn pci_device_name(vendor: u16, product: u16) -> Option<String> {
    let database = PCI_ID_DATABASES
        .iter()
        .find_map(|path| fs::read_to_string(path).ok())?;
    let vendor_prefix = format!("{vendor:04x}  ");
    let device_prefix = format!("\t{product:04x}  ");
    let mut lines = database.lines();
    lines.find(|line| line.starts_with(&vendor_prefix))?;
    lines
        .take_while(|line| line.starts_with('\t') || line.starts_with('#') || line.is_empty())
        .find_map(|line| line.strip_prefix(&device_prefix))
        .map(|name| name.trim().to_string())
}
