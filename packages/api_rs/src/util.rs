pub trait NonEmpty {
    fn non_empty(&self) -> Option<&Self>;
}

impl NonEmpty for str {
    fn non_empty(&self) -> Option<&Self> {
        let value = self.trim();

        if value.is_empty() { None } else { Some(value) }
    }
}
