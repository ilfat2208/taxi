package kz.taxi.catalog.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import kz.taxi.catalog.application.CatalogQueryService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** The catalog's category rail. */
@RestController
@RequestMapping("/api/v1/catalog/categories")
@Tag(name = "Catalog")
public class CategoryController {

    private final CatalogQueryService catalog;

    public CategoryController(CatalogQueryService catalog) {
        this.catalog = catalog;
    }

    @GetMapping
    @Operation(summary = "Categories on sale",
            description = "Distinct categories of products in status ACTIVE, alphabetically. "
                    + "A category with only drafts or archived offers is not advertised.")
    public List<String> categories() {
        return catalog.listCategories();
    }
}
